from __future__ import annotations

import gzip
import unittest
from unittest.mock import AsyncMock, patch

from app.services.paper_ingestion import (
    IngestionError,
    MAX_TOKENS,
    ParsedBlock,
    ParsedPaper,
    TokenCodec,
    chunk_paper,
    embed_chunks,
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
