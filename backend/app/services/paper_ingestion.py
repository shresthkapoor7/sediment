from __future__ import annotations

import asyncio
import contextlib
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from hashlib import sha256
from io import BytesIO
import logging
import math
import re
from typing import Iterable
import xml.etree.ElementTree as ET
import zlib

from fastapi import HTTPException

from ..config import settings
from ..db.supabase import SupabaseClient
from .openalex import OpenAlexClient, OpenAlexError
from .paper_access import DownloadedContent, PaperAccessChecker
from .voyage import VoyageError, embed_texts

logger = logging.getLogger(__name__)

TARGET_TOKENS = 600
MIN_TOKENS = 150
MAX_TOKENS = 800
OVERLAP_TOKENS = 80
MAX_XML_DECOMPRESSED_BYTES = 100 * 1024 * 1024
PARSER_VERSION = "2"
PAPER_PARSE_MAX_WORKERS = 2
PAPER_PARSE_EXECUTOR = ThreadPoolExecutor(
    max_workers=PAPER_PARSE_MAX_WORKERS,
    thread_name_prefix="paper-parser",
)


class IngestionError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


async def parse_downloaded_paper_in_executor(
    downloaded: DownloadedContent,
    fallback_title: str,
) -> ParsedPaper:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(
        PAPER_PARSE_EXECUTOR,
        parse_downloaded_paper,
        downloaded,
        fallback_title,
    )


def shutdown_paper_parse_executor() -> None:
    PAPER_PARSE_EXECUTOR.shutdown(wait=False, cancel_futures=True)


@dataclass(frozen=True)
class ParsedBlock:
    text: str
    section: str
    section_type: str
    page_start: int | None = None
    page_end: int | None = None


@dataclass(frozen=True)
class ParsedPaper:
    title: str
    blocks: list[ParsedBlock]


@dataclass(frozen=True)
class PaperChunk:
    content: str
    section: str
    section_type: str
    page_start: int | None
    page_end: int | None
    token_count: int
    embedding_input: str


class TokenCodec:
    def __init__(self) -> None:
        try:
            import tiktoken

            self._encoding = tiktoken.get_encoding("cl100k_base")
        except (ImportError, ValueError):
            self._encoding = None

    def count(self, text: str) -> int:
        if self._encoding:
            return len(self._encoding.encode(text))
        return max(1, math.ceil(len(text) / 4))

    def slices(self, text: str, size: int, overlap: int = 0) -> list[str]:
        if self._encoding:
            tokens = self._encoding.encode(text)
            step = max(1, size - overlap)
            return [self._encoding.decode(tokens[start:start + size]) for start in range(0, len(tokens), step)]

        char_size = size * 4
        char_overlap = overlap * 4
        step = max(1, char_size - char_overlap)
        return [text[start:start + char_size] for start in range(0, len(text), step)]

    def tail(self, text: str, size: int) -> str:
        if self._encoding:
            tokens = self._encoding.encode(text)
            return self._encoding.decode(tokens[-size:])
        return text[-size * 4:]


class PaperIngestionLease:
    def __init__(self, db: SupabaseClient, document_id: str, lease_id: str) -> None:
        self.db = db
        self.document_id = document_id
        self.lease_id = lease_id
        self.status = "fetching"
        self._lost = False
        self._renew_lock = asyncio.Lock()
        self._heartbeat_task: asyncio.Task[None] | None = None

    async def transition(self, status: str) -> None:
        async with self._renew_lock:
            if self._lost or not await self.db.renew_paper_ingestion_lease(
                self.document_id,
                self.lease_id,
                status,
            ):
                self._lost = True
                raise IngestionError("ingestion_lease_lost", "Paper ingestion ownership was lost. Please retry.")
            self.status = status

    async def start_heartbeat(self) -> None:
        if self._heartbeat_task is None:
            self._heartbeat_task = asyncio.create_task(self._heartbeat())

    def ensure_active(self) -> None:
        if self._lost:
            raise IngestionError("ingestion_lease_lost", "Paper ingestion ownership was lost. Please retry.")

    async def close(self) -> None:
        if self._heartbeat_task is None:
            return
        self._heartbeat_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await self._heartbeat_task
        self._heartbeat_task = None

    async def _heartbeat(self) -> None:
        interval = max(1, settings.paper_ingestion_lease_heartbeat_seconds)
        while True:
            await asyncio.sleep(interval)
            try:
                async with self._renew_lock:
                    renewed = await self.db.renew_paper_ingestion_lease(
                        self.document_id,
                        self.lease_id,
                        self.status,
                    )
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.warning("Paper ingestion lease heartbeat failed for document_id=%r", self.document_id, exc_info=True)
                continue
            if not renewed:
                self._lost = True
                logger.warning("Paper ingestion lease was lost for document_id=%r", self.document_id)
                return


class PaperIngestionService:
    def __init__(self) -> None:
        self.db = SupabaseClient()
        self.codec = TokenCodec()

    async def ingest(self, openalex_id: str, graph_paper: dict, *, billing_ip: str | None = None) -> dict:
        cached = await self.db.get_ready_paper_document(openalex_id)
        if cached:
            return self._result("cached", cached, int(cached.get("chunk_count") or 0))
        if not settings.voyage_api_key.get_secret_value():
            raise IngestionError("embedding_not_configured", "Paper embeddings are not configured.")

        try:
            async with OpenAlexClient(
                api_key=settings.openalex_api_key,
                mailto=settings.openalex_mailto,
            ) as client:
                metadata = await client.fetch_access_metadata(openalex_id)
        except OpenAlexError as exc:
            raise IngestionError("access_provider_failed", "Paper access provider failed.") from exc
        if not metadata:
            return self._unavailable()

        downloaded = await PaperAccessChecker().download_first_available(metadata)
        if not downloaded:
            return self._unavailable()

        checksum = sha256(downloaded.content).hexdigest()
        parser_name = "grobid_tei" if downloaded.candidate.content_kind == "xml" else "docling"
        prepared = await self.db.prepare_paper_ingestion({
            "p_openalex_id": openalex_id,
            "p_doi": metadata.get("doi"),
            "p_source_type": downloaded.candidate.source_type,
            "p_source_url": downloaded.source_url,
            "p_license": downloaded.candidate.license,
            "p_checksum": checksum,
            "p_parser": parser_name,
            "p_parser_version": PARSER_VERSION,
            "p_embedding_model": settings.embedding_model,
            "p_embedding_dimensions": settings.embedding_dimensions,
        })
        document_id = prepared["document_id"]
        if not prepared.get("is_claimed"):
            status = "cached" if prepared.get("ingestion_status") == "ready" else "processing"
            return {
                "status": status,
                "documentId": document_id,
                "chunkCount": int(prepared.get("chunk_count") or 0),
                "sourceType": downloaded.candidate.source_type,
                "message": "Paper is already cached." if status == "cached" else "Paper ingestion is already in progress.",
            }

        lease_id = prepared.get("lease_id")
        if not isinstance(lease_id, str) or not lease_id:
            raise IngestionError("ingestion_lease_missing", "Paper ingestion could not establish ownership. Please retry.")
        lease = PaperIngestionLease(self.db, document_id, lease_id)

        try:
            await lease.transition("fetching")
            await lease.transition("parsing")
            await lease.start_heartbeat()
            try:
                parsed = await asyncio.wait_for(
                    parse_downloaded_paper_in_executor(
                        downloaded,
                        graph_paper.get("title") or "Untitled paper",
                    ),
                    timeout=settings.paper_parse_timeout_seconds,
                )
            except asyncio.TimeoutError as exc:
                raise IngestionError(
                    "pdf_parse_timed_out",
                    "Paper parsing timed out. You can retry the indexing request.",
                ) from exc
            lease.ensure_active()
            chunks = chunk_paper(parsed, self.codec)
            if not chunks:
                raise IngestionError("no_extractable_text", "No extractable paper text was found.")

            await lease.transition("embedding")
            embeddings = await embed_chunks(chunks, billing_ip=billing_ip)
            lease.ensure_active()
            rows = [
                {
                    "document_id": document_id,
                    "openalex_id": openalex_id,
                    "chunk_index": index,
                    "content": chunk.content,
                    "embedding": embedding,
                    "section": chunk.section,
                    "section_type": chunk.section_type,
                    "page_start": chunk.page_start,
                    "page_end": chunk.page_end,
                    "token_count": chunk.token_count,
                    "metadata": {"title": parsed.title},
                }
                for index, (chunk, embedding) in enumerate(zip(chunks, embeddings))
            ]
            await self.db.replace_paper_chunks(document_id, rows)
            lease.ensure_active()
            completed = await self.db.complete_paper_ingestion(document_id, lease_id)
            return {
                "status": "ready",
                "documentId": document_id,
                "chunkCount": int(completed.get("chunk_count") or len(rows)),
                "sourceType": downloaded.candidate.source_type,
                "message": "Complete paper text is indexed and ready to search.",
            }
        except IngestionError as exc:
            with contextlib.suppress(Exception):
                await self.db.fail_paper_ingestion(document_id, lease_id, exc.code)
            raise
        except asyncio.CancelledError:
            with contextlib.suppress(Exception):
                await asyncio.shield(
                    self.db.fail_paper_ingestion(document_id, lease_id, "ingestion_cancelled"),
                )
            raise
        except Exception as exc:
            logger.exception("Paper ingestion failed for document_id=%r", document_id)
            with contextlib.suppress(Exception):
                await self.db.fail_paper_ingestion(document_id, lease_id, "ingestion_failed")
            raise IngestionError("ingestion_failed", "Paper ingestion failed.") from exc
        finally:
            await lease.close()

    def _result(self, status: str, document: dict, chunk_count: int) -> dict:
        return {
            "status": status,
            "documentId": document.get("id"),
            "chunkCount": chunk_count,
            "sourceType": document.get("source_type"),
            "message": "Complete paper text is cached and ready to search.",
        }

    def _unavailable(self) -> dict:
        return {
            "status": "unavailable",
            "documentId": None,
            "chunkCount": 0,
            "sourceType": None,
            "message": "Complete text is not available from an authorized source.",
        }


def parse_downloaded_paper(downloaded: DownloadedContent, fallback_title: str) -> ParsedPaper:
    if downloaded.candidate.content_kind == "xml":
        return parse_tei(downloaded.content, fallback_title)
    return parse_pdf(downloaded.content, fallback_title)


def _bounded_gunzip(content: bytes) -> bytes:
    if not content.startswith(b"\x1f\x8b"):
        return content
    inflater = zlib.decompressobj(16 + zlib.MAX_WBITS)
    output = inflater.decompress(content, MAX_XML_DECOMPRESSED_BYTES + 1)
    if len(output) > MAX_XML_DECOMPRESSED_BYTES or inflater.unconsumed_tail:
        raise IngestionError("xml_too_large", "Expanded XML exceeds the configured limit.")
    output += inflater.flush(MAX_XML_DECOMPRESSED_BYTES + 1 - len(output))
    if len(output) > MAX_XML_DECOMPRESSED_BYTES:
        raise IngestionError("xml_too_large", "Expanded XML exceeds the configured limit.")
    return output


def _tag(element: ET.Element) -> str:
    return element.tag.rsplit("}", 1)[-1].lower() if isinstance(element.tag, str) else ""


def _text(element: ET.Element) -> str:
    return re.sub(r"\s+", " ", " ".join(element.itertext())).strip()


def _page_number(raw: str | None, current: int | None) -> int | None:
    if raw and raw.isdigit():
        return int(raw)
    return (current + 1) if current is not None else 1


def parse_tei(content: bytes, fallback_title: str) -> ParsedPaper:
    xml = _bounded_gunzip(content)
    if b"<!DOCTYPE" in xml.upper():
        raise IngestionError("unsafe_xml", "XML document types are not accepted.")
    try:
        root = ET.fromstring(xml)
    except ET.ParseError as exc:
        raise IngestionError("malformed_xml", "TEI XML could not be parsed.") from exc

    title = next((_text(item) for item in root.iter() if _tag(item) == "title" and _text(item)), fallback_title)
    blocks: list[ParsedBlock] = []
    page = [None]

    def add_block(element: ET.Element, section: str, section_type: str) -> None:
        start_page = page[0]
        for descendant in element.iter():
            if _tag(descendant) == "pb":
                page[0] = _page_number(descendant.get("n"), page[0])
        text = _text(element)
        if text:
            blocks.append(ParsedBlock(text, section, section_type, start_page, page[0] or start_page))

    def walk(element: ET.Element, section: str, section_type: str) -> None:
        local_section = section
        local_type = section_type
        if _tag(element) == "div":
            heading = next((_text(child) for child in element if _tag(child) == "head" and _text(child)), "")
            if heading:
                local_section = heading
            div_type = (element.get("type") or "").lower()
            if "ref" in div_type or "reference" in local_section.lower() or "bibliography" in local_section.lower():
                local_type = "references"

        for child in element:
            tag = _tag(child)
            if tag == "head":
                continue
            if tag == "pb":
                page[0] = _page_number(child.get("n"), page[0])
            elif tag == "p":
                add_block(child, local_section, local_type)
            elif tag in {"figure", "table"}:
                add_block(child, local_section, tag)
            elif tag == "div":
                walk(child, local_section, local_type)
            else:
                walk(child, local_section, local_type)

    for abstract in (item for item in root.iter() if _tag(item) == "abstract"):
        text = _text(abstract)
        if text:
            blocks.append(ParsedBlock(text, "Abstract", "abstract"))
        break
    body = next((item for item in root.iter() if _tag(item) == "body"), None)
    if body is not None:
        walk(body, "Body", "body")
    if not blocks:
        raise IngestionError("no_extractable_text", "TEI contained no extractable body text.")
    return ParsedPaper(title=title or fallback_title, blocks=blocks)


def parse_pdf(content: bytes, fallback_title: str) -> ParsedPaper:
    try:
        from docling.datamodel.base_models import DocumentStream, InputFormat
        from docling.document_converter import DocumentConverter
    except ImportError as exc:
        raise IngestionError("pdf_parser_unavailable", "The PDF parser is not installed.") from exc

    try:
        converter = DocumentConverter(allowed_formats=[InputFormat.PDF])
        result = converter.convert(
            DocumentStream(name="paper.pdf", stream=BytesIO(content)),
            max_num_pages=settings.max_paper_pdf_pages,
            max_file_size=len(content),
        )
        document = result.document
    except Exception as exc:
        raise IngestionError("pdf_parse_failed", "PDF could not be parsed.") from exc

    title = getattr(document, "name", None) or fallback_title
    blocks: list[ParsedBlock] = []
    section = "Body"
    for item, _level in document.iterate_items():
        label = str(getattr(item, "label", "")).lower().rsplit(".", 1)[-1]
        text = str(getattr(item, "text", "") or "").strip()
        if label in {"title", "section_header"} and text:
            section = text
            if label == "title":
                title = text
            continue
        if label == "table" and hasattr(item, "export_to_markdown"):
            table_markdown = item.export_to_markdown(document)
            if isinstance(table_markdown, str) and table_markdown.strip():
                text = table_markdown
        if not text:
            continue
        provenance = getattr(item, "prov", None) or []
        pages = [getattr(prov, "page_no", None) for prov in provenance]
        pages = [page for page in pages if isinstance(page, int)]
        section_type = "references" if "reference" in section.lower() else label or "body"
        blocks.append(ParsedBlock(
            text=_normalize_pdf_text(text, preserve_lines=label == "table"),
            section=section,
            section_type=section_type,
            page_start=min(pages) if pages else None,
            page_end=max(pages) if pages else None,
        ))
    if not blocks:
        raise IngestionError("no_extractable_text", "PDF contained no extractable text.")
    return ParsedPaper(title=title, blocks=blocks)


def _normalize_pdf_text(text: str, *, preserve_lines: bool) -> str:
    if not preserve_lines:
        return re.sub(r"\s+", " ", text).strip()
    return "\n".join(
        re.sub(r"[^\S\r\n]+", " ", line).strip()
        for line in text.splitlines()
        if line.strip()
    )


def _split_blocks(blocks: Iterable[ParsedBlock], codec: TokenCodec) -> list[ParsedBlock]:
    split: list[ParsedBlock] = []
    for block in blocks:
        if codec.count(block.text) <= MAX_TOKENS:
            split.append(block)
            continue
        split.extend(
            ParsedBlock(text, block.section, block.section_type, block.page_start, block.page_end)
            for text in codec.slices(block.text, MAX_TOKENS - OVERLAP_TOKENS, OVERLAP_TOKENS)
            if text.strip()
        )
    return split


def chunk_paper(parsed: ParsedPaper, codec: TokenCodec | None = None) -> list[PaperChunk]:
    codec = codec or TokenCodec()
    blocks = _split_blocks(parsed.blocks, codec)
    groups: list[list[ParsedBlock]] = []
    current: list[ParsedBlock] = []
    current_tokens = 0
    current_has_new_content = False

    for block in blocks:
        block_tokens = codec.count(block.text)
        if current and current_tokens + block_tokens > MAX_TOKENS:
            groups.append(current)
            overlap = codec.tail("\n\n".join(item.text for item in current), OVERLAP_TOKENS)
            current = [ParsedBlock(
                overlap,
                current[-1].section,
                current[-1].section_type,
                current[-1].page_start,
                current[-1].page_end,
            )] if overlap.strip() else []
            current_tokens = codec.count(overlap) if overlap.strip() else 0
            current_has_new_content = False
        current.append(block)
        current_tokens += block_tokens
        current_has_new_content = True
        if current_tokens >= TARGET_TOKENS:
            groups.append(current)
            overlap = codec.tail("\n\n".join(item.text for item in current), OVERLAP_TOKENS)
            current = [ParsedBlock(
                overlap,
                current[-1].section,
                current[-1].section_type,
                current[-1].page_start,
                current[-1].page_end,
            )] if overlap.strip() else []
            current_tokens = codec.count(overlap) if overlap.strip() else 0
            current_has_new_content = False
    if current and current_has_new_content:
        if groups and sum(codec.count(item.text) for item in current) < MIN_TOKENS:
            candidate = [*groups[-1], *current]
            if codec.count("\n\n".join(item.text for item in candidate)) <= MAX_TOKENS:
                groups[-1] = candidate
            else:
                groups.append(current)
        else:
            groups.append(current)

    chunks: list[PaperChunk] = []
    for group in groups:
        content = "\n\n".join(item.text for item in group).strip()
        sections = list(dict.fromkeys(item.section for item in group if item.section))
        section = " / ".join(sections[:3]) or "Body"
        section_types = {item.section_type for item in group}
        section_type = next(iter(section_types)) if len(section_types) == 1 else "mixed"
        pages = [page for item in group for page in (item.page_start, item.page_end) if page is not None]
        token_count = codec.count(content)
        chunks.append(PaperChunk(
            content=content,
            section=section,
            section_type=section_type,
            page_start=min(pages) if pages else None,
            page_end=max(pages) if pages else None,
            token_count=token_count,
            embedding_input=f"{parsed.title}\nSection: {section}\n\n{content}",
        ))
    return chunks


async def embed_chunks(chunks: list[PaperChunk], *, billing_ip: str | None = None) -> list[list[float]]:
    embeddings: list[list[float]] = []
    try:
        for start in range(0, len(chunks), 64):
            batch = chunks[start:start + 64]
            embeddings.extend(await embed_texts(
                [chunk.embedding_input for chunk in batch],
                input_type="document",
                billing_ip=billing_ip,
            ))
    except HTTPException as exc:
        logger.warning(
            "Paper embedding blocked by budget/status=%s detail=%s chunks=%s",
            exc.status_code,
            exc.detail,
            len(chunks),
        )
        raise IngestionError("embedding_budget_exceeded", str(exc.detail)) from exc
    except VoyageError as exc:
        logger.warning(
            "Paper embedding failed code=%s chunks=%s",
            exc.code,
            len(chunks),
        )
        raise IngestionError(exc.code, _embedding_error_message(exc.code)) from exc
    return embeddings


def _embedding_error_message(code: str) -> str:
    if code == "voyage_not_configured":
        return "Embedding failed because Voyage is not configured on the backend."
    if code == "embedding_auth_failed":
        return "Embedding failed because the Voyage API key was rejected."
    if code == "embedding_billing_required":
        return "Embedding failed because the Voyage account requires billing or credits."
    if code == "embedding_rate_limited":
        return "Embedding failed because Voyage rate-limited the request."
    if code == "embedding_provider_unavailable":
        return "Embedding failed because Voyage was temporarily unavailable."
    if code == "embedding_invalid_dimensions":
        return "Embedding failed because Voyage returned dimensions that do not match the database."
    if code == "embedding_invalid_response":
        return "Embedding failed because Voyage returned an invalid response."
    return "Embedding failed because Voyage rejected the request."
