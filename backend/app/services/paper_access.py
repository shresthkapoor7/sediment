from __future__ import annotations

import asyncio
from dataclasses import dataclass
from ipaddress import ip_address
import re
import socket
from typing import Literal
from urllib.parse import quote, urlencode, urljoin, urlparse, urlunparse
import zlib

import aiohttp

from ..config import settings
from ..db.supabase import SupabaseAPIError, SupabaseClient, SupabaseConfigError
from .openalex import OpenAlexClient, OpenAlexError

MAX_REDIRECTS = 3
MAX_PDF_BYTES = 50 * 1024 * 1024
MAX_XML_BYTES = 25 * 1024 * 1024
PROBE_BYTES = 8192
DOI_PREFIX = re.compile(r"^https?://(?:dx\.)?doi\.org/", re.IGNORECASE)

SourceType = Literal["openalex_tei", "openalex_pdf", "unpaywall_pdf"]


@dataclass(frozen=True)
class ContentCandidate:
    source_type: SourceType
    url: str
    content_kind: Literal["pdf", "xml"]
    license: str | None


@dataclass(frozen=True)
class DownloadedContent:
    candidate: ContentCandidate
    content: bytes
    source_url: str


class PaperAccessChecker:
    async def check(self, openalex_id: str) -> dict:
        document = await self._get_document(openalex_id)
        if document and document.get("ingestion_status") == "ready" and int(document.get("chunk_count") or 0) > 0:
            return {
                "openalexId": openalex_id,
                "accessStatus": "available",
                "ingestionStatus": "ready",
                "sourceType": document.get("source_type"),
                "license": document.get("license"),
                "requiresConfirmation": False,
                "message": "Complete paper text is cached and ready to search.",
            }
        if document and document.get("ingestion_status") in {"fetching", "parsing", "embedding"}:
            return {
                "openalexId": openalex_id,
                "accessStatus": "available",
                "ingestionStatus": "processing",
                "sourceType": document.get("source_type"),
                "license": document.get("license"),
                "requiresConfirmation": False,
                "message": "Complete paper text is still being indexed. It is not available to search yet.",
            }
        if document and document.get("ingestion_status") == "failed":
            return {
                "openalexId": openalex_id,
                "accessStatus": "available",
                "ingestionStatus": "failed",
                "sourceType": document.get("source_type"),
                "license": document.get("license"),
                "requiresConfirmation": True,
                "message": "The previous paper indexing attempt failed. Confirm to retry it.",
            }

        try:
            async with OpenAlexClient(
                api_key=settings.openalex_api_key,
                mailto=settings.openalex_mailto,
            ) as client:
                metadata = await client.fetch_access_metadata(openalex_id)
        except OpenAlexError:
            return self._failed(openalex_id)

        if not metadata:
            return self._unavailable(openalex_id)

        timeout = aiohttp.ClientTimeout(total=12, connect=4, sock_read=5)
        async with aiohttp.ClientSession(
            timeout=timeout,
            headers={"User-Agent": "Sediment/1.0 (paper access check)"},
        ) as session:
            for candidate in self._openalex_candidates(metadata):
                if await self._probe_candidate(session, candidate):
                    return self._available(openalex_id, candidate)

            unpaywall_candidate = await self._unpaywall_candidate(metadata.get("doi"))
            if unpaywall_candidate and await self._probe_candidate(session, unpaywall_candidate):
                return self._available(openalex_id, unpaywall_candidate)

        return self._unavailable(openalex_id)

    async def download_first_available(self, metadata: dict) -> DownloadedContent | None:
        timeout = aiohttp.ClientTimeout(total=90, connect=8, sock_read=20)
        async with aiohttp.ClientSession(
            timeout=timeout,
            auto_decompress=False,
            headers={"User-Agent": "Sediment/1.0 (authorized paper retrieval)"},
        ) as session:
            for candidate in self._openalex_candidates(metadata):
                downloaded = await self._download_candidate(session, candidate)
                if downloaded:
                    return downloaded

            unpaywall_candidate = await self._unpaywall_candidate(metadata.get("doi"))
            if unpaywall_candidate:
                return await self._download_candidate(session, unpaywall_candidate)
        return None

    async def _get_document(self, openalex_id: str) -> dict | None:
        try:
            db = SupabaseClient()
            ready_document = await db.get_ready_paper_document(openalex_id)
            return ready_document or await db.get_latest_paper_document(openalex_id)
        except (SupabaseConfigError, SupabaseAPIError):
            return None

    def _openalex_candidates(self, metadata: dict) -> list[ContentCandidate]:
        candidates: list[ContentCandidate] = []
        content_tei_url = metadata.get("contentTeiUrl")
        content_pdf_url = metadata.get("contentPdfUrl")
        if settings.openalex_api_key:
            if metadata.get("hasContentTei") and isinstance(content_tei_url, str):
                candidates.append(ContentCandidate(
                    source_type="openalex_tei",
                    url=self._openalex_content_url(content_tei_url),
                    content_kind="xml",
                    license=metadata.get("license"),
                ))
            if metadata.get("hasContentPdf") and isinstance(content_pdf_url, str):
                candidates.append(ContentCandidate(
                    source_type="openalex_pdf",
                    url=self._openalex_content_url(content_pdf_url),
                    content_kind="pdf",
                    license=metadata.get("license"),
                ))

        oa_pdf_url = metadata.get("oaPdfUrl")
        if metadata.get("isOa") and isinstance(oa_pdf_url, str):
            candidates.append(ContentCandidate(
                source_type="openalex_pdf",
                url=oa_pdf_url,
                content_kind="pdf",
                license=metadata.get("license"),
            ))
        return candidates

    def _openalex_content_url(self, base_url: str) -> str:
        parsed = urlparse(base_url)
        query_params = {"api_key": settings.openalex_api_key}
        return urlunparse(parsed._replace(query=urlencode(query_params), fragment=""))

    async def _unpaywall_candidate(self, raw_doi: object) -> ContentCandidate | None:
        email = settings.unpaywall_email or settings.openalex_mailto
        if not email or not isinstance(raw_doi, str):
            return None
        doi = DOI_PREFIX.sub("", raw_doi).strip()
        if not doi:
            return None

        timeout = aiohttp.ClientTimeout(total=8, connect=3, sock_read=4)
        url = f"https://api.unpaywall.org/v2/{quote(doi, safe='/')}"
        try:
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.get(url, params={"email": email}) as response:
                    if response.status != 200:
                        return None
                    data = await response.json(content_type=None)
        except (aiohttp.ClientError, asyncio.TimeoutError, ValueError):
            return None

        if not isinstance(data, dict):
            return None
        location = data.get("best_oa_location")
        if not data.get("is_oa") or not isinstance(location, dict):
            return None
        pdf_url = location.get("url_for_pdf")
        if not isinstance(pdf_url, str):
            return None
        return ContentCandidate(
            source_type="unpaywall_pdf",
            url=pdf_url,
            content_kind="pdf",
            license=location.get("license"),
        )

    async def _probe_candidate(
        self,
        session: aiohttp.ClientSession,
        candidate: ContentCandidate,
    ) -> bool:
        current_url = candidate.url
        for _ in range(MAX_REDIRECTS + 1):
            if not await self._is_public_url(current_url):
                return False
            try:
                async with session.get(
                    current_url,
                    headers={"Range": f"bytes=0-{PROBE_BYTES - 1}"},
                    allow_redirects=False,
                ) as response:
                    if response.status in {301, 302, 303, 307, 308}:
                        location = response.headers.get("Location")
                        if not location:
                            return False
                        current_url = urljoin(current_url, location)
                        continue
                    if response.status not in {200, 206}:
                        return False
                    if self._declared_size(response) > self._max_size(candidate.content_kind):
                        return False
                    prefix = await response.content.read(PROBE_BYTES)
                    return self._matches_content(candidate.content_kind, prefix)
            except (aiohttp.ClientError, asyncio.TimeoutError):
                return False
        return False

    async def _download_candidate(
        self,
        session: aiohttp.ClientSession,
        candidate: ContentCandidate,
    ) -> DownloadedContent | None:
        current_url = candidate.url
        max_size = self._max_size(candidate.content_kind)
        for _ in range(MAX_REDIRECTS + 1):
            if not await self._is_public_url(current_url):
                return None
            try:
                async with session.get(current_url, allow_redirects=False) as response:
                    if response.status in {301, 302, 303, 307, 308}:
                        location = response.headers.get("Location")
                        if not location:
                            return None
                        current_url = urljoin(current_url, location)
                        continue
                    if response.status != 200 or self._declared_size(response) > max_size:
                        return None

                    content = bytearray()
                    async for piece in response.content.iter_chunked(64 * 1024):
                        content.extend(piece)
                        if len(content) > max_size:
                            return None
                    raw = bytes(content)
                    if not self._matches_content(candidate.content_kind, raw[:PROBE_BYTES]):
                        return None
                    return DownloadedContent(
                        candidate=candidate,
                        content=raw,
                        source_url=self._provenance_url(candidate.url),
                    )
            except (aiohttp.ClientError, asyncio.TimeoutError):
                return None
        return None

    def _provenance_url(self, raw_url: str) -> str:
        parsed = urlparse(raw_url)
        return urlunparse(parsed._replace(query="", fragment=""))

    async def _is_public_url(self, raw_url: str) -> bool:
        parsed = urlparse(raw_url)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
            return False
        try:
            addresses = await asyncio.to_thread(
                socket.getaddrinfo,
                parsed.hostname,
                parsed.port or 443,
                type=socket.SOCK_STREAM,
            )
        except socket.gaierror:
            return False
        try:
            return bool(addresses) and all(ip_address(item[4][0]).is_global for item in addresses)
        except ValueError:
            return False

    def _declared_size(self, response: aiohttp.ClientResponse) -> int:
        content_range = response.headers.get("Content-Range", "")
        if "/" in content_range:
            total = content_range.rsplit("/", 1)[-1]
            if total.isdigit():
                return int(total)
        content_length = response.headers.get("Content-Length", "")
        return int(content_length) if content_length.isdigit() else 0

    def _max_size(self, content_kind: str) -> int:
        return MAX_PDF_BYTES if content_kind == "pdf" else MAX_XML_BYTES

    def _matches_content(self, content_kind: str, prefix: bytes) -> bool:
        if content_kind == "pdf":
            return prefix.lstrip().startswith(b"%PDF-")
        if prefix.startswith(b"\x1f\x8b"):
            try:
                prefix = zlib.decompressobj(16 + zlib.MAX_WBITS).decompress(prefix, PROBE_BYTES)
            except zlib.error:
                return False
        lowered = prefix.lower()
        return b"<tei" in lowered or b"<tei:tei" in lowered

    def _unavailable(self, openalex_id: str) -> dict:
        return {
            "openalexId": openalex_id,
            "accessStatus": "unavailable",
            "ingestionStatus": "not_cached",
            "sourceType": None,
            "license": None,
            "requiresConfirmation": False,
            "message": "Complete text is not available. I can search reliable public sources instead.",
        }

    def _available(self, openalex_id: str, candidate: ContentCandidate) -> dict:
        return {
            "openalexId": openalex_id,
            "accessStatus": "available",
            "ingestionStatus": "not_cached",
            "sourceType": candidate.source_type,
            "license": candidate.license,
            "requiresConfirmation": True,
            "message": "Complete paper text is available. Ask in chat or use Access full paper to retrieve it.",
        }

    def _failed(self, openalex_id: str) -> dict:
        return {
            "openalexId": openalex_id,
            "accessStatus": "failed",
            "ingestionStatus": "failed",
            "sourceType": None,
            "license": None,
            "requiresConfirmation": False,
            "message": "The access check failed. Try again later.",
        }
