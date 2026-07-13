from __future__ import annotations

import asyncio
import gzip
import unittest
from unittest.mock import AsyncMock, patch

from app.config import settings
from app.services.paper_access import ContentCandidate, DownloadedContent
from app.services.paper_ingestion import (
    IngestionError,
    MAX_TOKENS,
    PaperIngestionService,
    PaperIngestionLease,
    PAPER_PARSE_EXECUTOR,
    ParsedBlock,
    ParsedPaper,
    TokenCodec,
    chunk_paper,
    embed_chunks,
    _normalize_pdf_text,
    parse_downloaded_paper_in_executor,
    parse_tei,
)
from app.services.voyage import VoyageError


TEI = b"""<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <teiHeader><fileDesc><titleStmt><title>Test Paper</title></titleStmt></fileDesc></teiHeader>
  <text>
    <front><abstract><p>An abstract with useful context.</p></abstract></front>
    <body>
      <div><head>Methods</head><p>First method paragraph.</p><pb n="3"/><p>Second method paragraph.</p>
        <figure><figDesc>A result diagram.</figDesc></figure>
      </div>
      <div type="references"><head>References</head><p>A cited work.</p></div>
    </body>
  </text>
</TEI>"""


class TeiParserTests(unittest.TestCase):
    def test_gzipped_tei_preserves_structure_and_pages(self) -> None:
        parsed = parse_tei(gzip.compress(TEI), "Fallback")

        self.assertEqual(parsed.title, "Test Paper")
        self.assertEqual(parsed.blocks[0].section_type, "abstract")
        methods = [block for block in parsed.blocks if block.section == "Methods"]
        self.assertTrue(methods)
        self.assertTrue(any(block.page_start == 3 for block in methods))
        self.assertTrue(any(block.section_type == "figure" for block in methods))
        self.assertEqual(parsed.blocks[-1].section_type, "references")

    def test_rejects_document_types(self) -> None:
        with self.assertRaisesRegex(IngestionError, "document types"):
            parse_tei(b'<!DOCTYPE foo><TEI><text><body><p>x</p></body></text></TEI>', "Fallback")


class ChunkingTests(unittest.TestCase):
    def test_table_text_preserves_markdown_rows(self) -> None:
        table = "| Metric | Score |\n| --- | --- |\n| BLEU | 31.4 |"
        self.assertEqual(_normalize_pdf_text(table, preserve_lines=True), table)

    def test_chunks_are_bounded_and_include_embedding_context(self) -> None:
        codec = TokenCodec()
        paragraphs = [
            ParsedBlock((f"paragraph {index} " * 90).strip(), "Methods", "body", index, index)
            for index in range(1, 15)
        ]
        chunks = chunk_paper(ParsedPaper("Test Paper", paragraphs), codec)

        self.assertGreater(len(chunks), 1)
        self.assertTrue(all(0 < chunk.token_count <= MAX_TOKENS for chunk in chunks))
        self.assertTrue(all(chunk.embedding_input.startswith("Test Paper\nSection: Methods") for chunk in chunks))
        self.assertNotEqual(chunks[-1].content, chunks[-2].content)


class EmbeddingErrorTests(unittest.IsolatedAsyncioTestCase):
    async def test_parse_timeout_marks_the_document_failed(self) -> None:
        service = object.__new__(PaperIngestionService)
        service.db = AsyncMock()
        service.db.get_ready_paper_document.return_value = None
        service.db.prepare_paper_ingestion.return_value = {
            "document_id": "document-1",
            "is_claimed": True,
            "lease_id": "lease-1",
        }
        service.db.renew_paper_ingestion_lease.return_value = True
        service.codec = TokenCodec()

        downloaded = DownloadedContent(
            candidate=ContentCandidate("openalex_pdf", "https://example.test/paper.pdf", "pdf", None),
            content=b"%PDF-1.7",
            source_url="https://example.test/paper.pdf",
        )
        access = AsyncMock()
        access.download_first_available.return_value = downloaded

        class OpenAlexContext:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *_args):
                return False

            async def fetch_access_metadata(self, _openalex_id):
                return {"doi": None}

        async def never_returns():
            await __import__("asyncio").Event().wait()

        with patch("app.services.paper_ingestion.OpenAlexClient", return_value=OpenAlexContext()):
            with patch("app.services.paper_ingestion.PaperAccessChecker", return_value=access):
                with patch(
                    "app.services.paper_ingestion.parse_downloaded_paper_in_executor",
                    new=lambda *_args, **_kwargs: never_returns(),
                ):
                    with patch.object(settings, "paper_parse_timeout_seconds", 0.001):
                        with self.assertRaisesRegex(IngestionError, "timed out") as raised:
                            await service.ingest("W1", {"title": "Test"})

        self.assertEqual(raised.exception.code, "pdf_parse_timed_out")
        service.db.fail_paper_ingestion.assert_awaited_with(
            "document-1", "lease-1", "pdf_parse_timed_out",
        )

    async def test_lease_transitions_and_heartbeats_verify_ownership(self) -> None:
        db = AsyncMock()
        db.renew_paper_ingestion_lease.return_value = True
        lease = PaperIngestionLease(db, "document-1", "lease-1")

        await lease.transition("fetching")
        await lease.transition("parsing")
        await lease.transition("embedding")

        self.assertEqual(lease.status, "embedding")
        self.assertEqual(
            db.renew_paper_ingestion_lease.await_args_list[0].args,
            ("document-1", "lease-1", "fetching"),
        )
        self.assertEqual(
            db.renew_paper_ingestion_lease.await_args_list[1].args,
            ("document-1", "lease-1", "parsing"),
        )
        self.assertEqual(
            db.renew_paper_ingestion_lease.await_args_list[2].args,
            ("document-1", "lease-1", "embedding"),
        )

    async def test_heartbeat_marks_a_lost_lease_before_later_writes(self) -> None:
        db = AsyncMock()
        db.renew_paper_ingestion_lease.return_value = False
        lease = PaperIngestionLease(db, "document-1", "lease-1")
        lease.status = "parsing"

        with patch("app.services.paper_ingestion.asyncio.sleep", AsyncMock()):
            await lease._heartbeat()

        db.renew_paper_ingestion_lease.assert_awaited_once_with("document-1", "lease-1", "parsing")
        with self.assertRaisesRegex(IngestionError, "ownership was lost"):
            lease.ensure_active()

    async def test_parser_uses_the_dedicated_bounded_executor(self) -> None:
        expected = ParsedPaper("Test", [])
        event_loop = asyncio.get_running_loop()

        class FakeLoop:
            def __init__(self):
                self.executor = None

            def run_in_executor(self, executor, _function, *_args):
                self.executor = executor
                future = event_loop.create_future()
                future.set_result(expected)
                return future

        fake_loop = FakeLoop()
        downloaded = DownloadedContent(
            candidate=ContentCandidate("openalex_pdf", "https://example.test/paper.pdf", "pdf", None),
            content=b"%PDF-1.7",
            source_url="https://example.test/paper.pdf",
        )
        with patch("app.services.paper_ingestion.asyncio.get_running_loop", return_value=fake_loop):
            result = await parse_downloaded_paper_in_executor(downloaded, "Fallback")

        self.assertIs(result, expected)
        self.assertIs(fake_loop.executor, PAPER_PARSE_EXECUTOR)

    async def test_unexpected_ingestion_failure_is_logged_before_wrapping(self) -> None:
        service = object.__new__(PaperIngestionService)
        service.db = AsyncMock()
        service.db.get_ready_paper_document.return_value = None
        service.db.prepare_paper_ingestion.return_value = {
            "document_id": "document-1",
            "is_claimed": True,
            "lease_id": "lease-1",
        }
        service.db.renew_paper_ingestion_lease.return_value = True
        service.codec = TokenCodec()
        downloaded = DownloadedContent(
            candidate=ContentCandidate("openalex_pdf", "https://example.test/paper.pdf", "pdf", None),
            content=b"%PDF-1.7",
            source_url="https://example.test/paper.pdf",
        )
        access = AsyncMock()
        access.download_first_available.return_value = downloaded

        class OpenAlexContext:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *_args):
                return False

            async def fetch_access_metadata(self, _openalex_id):
                return {"doi": None}

        with patch("app.services.paper_ingestion.OpenAlexClient", return_value=OpenAlexContext()):
            with patch("app.services.paper_ingestion.PaperAccessChecker", return_value=access):
                with patch(
                    "app.services.paper_ingestion.parse_downloaded_paper_in_executor",
                    AsyncMock(return_value=ParsedPaper("Test", [])),
                ):
                    with patch("app.services.paper_ingestion.chunk_paper", side_effect=RuntimeError("parser bug")):
                        with patch("app.services.paper_ingestion.logger.exception") as log_failure:
                            with self.assertRaises(IngestionError) as raised:
                                await service.ingest("W1", {"title": "Test"})

        self.assertEqual(raised.exception.code, "ingestion_failed")
        log_failure.assert_called_once_with("Paper ingestion failed for document_id=%r", "document-1")
        service.db.fail_paper_ingestion.assert_awaited_with("document-1", "lease-1", "ingestion_failed")

    async def test_embedding_error_preserves_safe_provider_code(self) -> None:
        chunk = chunk_paper(
            ParsedPaper("Test", [ParsedBlock("method text " * 40, "Methods", "body")]),
            TokenCodec(),
        )[0]

        with patch(
            "app.services.paper_ingestion.embed_texts",
            AsyncMock(side_effect=VoyageError("embedding_billing_required", "rejected")),
        ):
            with self.assertRaises(IngestionError) as raised:
                await embed_chunks([chunk])

        self.assertEqual(raised.exception.code, "embedding_billing_required")
        self.assertIn("billing", str(raised.exception).lower())


if __name__ == "__main__":
    unittest.main()
