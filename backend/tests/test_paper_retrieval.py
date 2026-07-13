from __future__ import annotations

import unittest
from unittest.mock import AsyncMock, patch

from app.routers.paper_access import _paper_ids_from_graph, get_cached_paper_content
from app.services.paper_access import PaperAccessChecker
from app.services.paper_retrieval import PaperRetrievalService
from app.services.voyage import RerankResult, VoyageError


def candidate(index: int, *, paper_id: str = "W1", similarity: float = 0.7) -> dict:
    return {
        "chunk_id": f"chunk-{index}",
        "document_id": "document-1",
        "openalex_id": paper_id,
        "chunk_index": index,
        "content": f"content {index}",
        "section": "Methods",
        "section_type": "body",
        "page_start": index + 1,
        "page_end": index + 1,
        "token_count": 100,
        "metadata": {"title": "Test Paper"},
        "similarity": similarity,
        "source_type": "openalex_tei",
        "source_url": "https://api.openalex.org/works/W1/tei",
        "license": "cc-by",
    }


class PaperRetrievalTests(unittest.IsolatedAsyncioTestCase):
    async def test_access_check_reports_incomplete_ingestion_without_claiming_cached_text(self) -> None:
        db = AsyncMock()
        db.get_ready_paper_document.return_value = None
        db.get_latest_paper_document.return_value = {
            "source_type": "openalex_pdf",
            "license": "cc-by",
            "ingestion_status": "parsing",
            "chunk_count": 0,
        }

        with patch("app.services.paper_access.SupabaseClient", return_value=db):
            result = await PaperAccessChecker().check("W1")

        self.assertEqual(result["ingestionStatus"], "processing")
        self.assertFalse(result["requiresConfirmation"])
        self.assertIn("not available to search", result["message"])

    async def test_access_check_prefers_an_older_ready_document_over_a_newer_failed_one(self) -> None:
        db = AsyncMock()
        db.get_ready_paper_document.return_value = {
            "source_type": "openalex_tei",
            "license": "cc-by",
            "ingestion_status": "ready",
            "chunk_count": 4,
        }
        db.get_latest_paper_document.return_value = {
            "source_type": "openalex_pdf",
            "license": "cc-by",
            "ingestion_status": "failed",
            "chunk_count": 0,
        }

        with patch("app.services.paper_access.SupabaseClient", return_value=db):
            result = await PaperAccessChecker().check("W1")

        self.assertEqual(result["ingestionStatus"], "ready")
        self.assertEqual(result["sourceType"], "openalex_tei")
        db.get_latest_paper_document.assert_not_awaited()

    async def test_cached_content_returns_ordered_text_chunks_for_a_graph_paper(self) -> None:
        db = AsyncMock()
        db.get_graph.return_value = {
            "data": {
                "nodes": {
                    "1": {"paper": {"openalexId": "W1", "title": "Test Paper"}},
                },
            },
        }
        db.get_ready_paper_document.return_value = {
            "id": "document-1",
            "source_type": "openalex_tei",
            "source_url": "https://example.test/paper.xml",
        }
        db.list_paper_document_chunks.return_value = [
            {
                "chunk_index": 0,
                "content": "First section text.",
                "section": "Introduction",
                "section_type": "body",
                "page_start": 1,
                "page_end": 1,
            },
        ]

        with patch("app.routers.paper_access._db", return_value=db):
            response = await get_cached_paper_content("graph-1", "w1", user_id="user-1")

        self.assertEqual(response.title, "Test Paper")
        self.assertEqual(response.chunks[0].content, "First section text.")
        db.list_paper_document_chunks.assert_awaited_once_with("document-1", limit=101)

    async def test_cached_content_is_bounded_for_large_papers(self) -> None:
        db = AsyncMock()
        db.get_graph.return_value = {
            "data": {"nodes": {"1": {"paper": {"openalexId": "W1", "title": "Test Paper"}}}},
        }
        db.get_ready_paper_document.return_value = {
            "id": "document-1",
            "source_type": "openalex_tei",
            "source_url": "https://example.test/paper.xml",
        }
        db.list_paper_document_chunks.return_value = [
            {"chunk_index": index, "content": f"content {index}"}
            for index in range(101)
        ]

        with patch("app.routers.paper_access._db", return_value=db):
            response = await get_cached_paper_content("graph-1", "W1", user_id="user-1")

        self.assertEqual(len(response.chunks), 100)
        self.assertTrue(response.truncated)

    async def test_query_embedding_rerank_and_citation_format(self) -> None:
        db = AsyncMock()
        db.search_paper_chunks.return_value = [candidate(0, similarity=0.9), candidate(1, similarity=0.8)]
        service = PaperRetrievalService(db)

        with patch("app.services.paper_retrieval.embed_texts", AsyncMock(return_value=[[0.0] * 1024])) as embed:
            with patch(
                "app.services.paper_retrieval.rerank",
                AsyncMock(return_value=[RerankResult(index=1, relevance_score=0.97)]),
            ):
                result = await service.search_paper("W1", "What method was used?", limit=1)

        embed.assert_awaited_once_with(["What method was used?"], input_type="query", billing_ip=None)
        db.search_paper_chunks.assert_awaited_once()
        self.assertEqual(result["matches"][0]["content"], "content 1")
        self.assertEqual(result["matches"][0]["rerankScore"], 0.97)
        citation = result["matches"][0]["citation"]
        self.assertEqual(citation["section"], "Methods")
        self.assertEqual(citation["pageStart"], 2)
        self.assertIn("document:document-1:chunk:1", citation["id"])

    async def test_rerank_failure_falls_back_to_vector_order(self) -> None:
        db = AsyncMock()
        db.search_paper_chunks.return_value = [candidate(0), candidate(1)]
        service = PaperRetrievalService(db)

        with patch("app.services.paper_retrieval.embed_texts", AsyncMock(return_value=[[0.0] * 1024])):
            with patch(
                "app.services.paper_retrieval.rerank",
                AsyncMock(side_effect=VoyageError("rerank_provider_unavailable", "unavailable")),
            ):
                with patch("app.services.paper_retrieval.logger.warning"):
                    result = await service.search_paper("W1", "query", limit=2)

        self.assertEqual([match["content"] for match in result["matches"]], ["content 0", "content 1"])
        self.assertTrue(all(match["rerankScore"] is None for match in result["matches"]))

    async def test_graph_search_is_scoped_to_server_ids(self) -> None:
        db = AsyncMock()
        db.search_graph_paper_chunks.return_value = []
        service = PaperRetrievalService(db)
        ids = ["W1", "W2", "W1"]

        with patch("app.services.paper_retrieval.embed_texts", AsyncMock(return_value=[[0.0] * 1024])):
            result = await service.search_graph(ids, "query")

        self.assertEqual(result["matches"], [])
        args = db.search_graph_paper_chunks.await_args.args
        self.assertEqual(args[0], ["W1", "W2"])


class GraphContextTests(unittest.TestCase):
    def test_extracts_only_valid_openalex_ids(self) -> None:
        graph = {
            "nodes": {
                "1": {"paper": {"openalexId": "W123"}},
                "2": {"paper": {"openalexId": "not-valid"}},
                "3": {"paper": {"openalexId": "w456"}},
            },
        }
        self.assertEqual(_paper_ids_from_graph(graph), ["W123", "W456"])


if __name__ == "__main__":
    unittest.main()
