from __future__ import annotations

import logging
from typing import Awaitable, Callable

from ..config import settings
from ..db.supabase import SupabaseClient
from .voyage import VoyageError, embed_texts, rerank

logger = logging.getLogger(__name__)


class RetrievalError(RuntimeError):
    pass


SearchFunction = Callable[[list[float]], Awaitable[list[dict]]]


class PaperRetrievalService:
    def __init__(self, db: SupabaseClient | None = None) -> None:
        self.db = db or SupabaseClient()

    async def search_paper(
        self,
        openalex_id: str,
        query: str,
        *,
        limit: int = 6,
        billing_ip: str | None = None,
        use_rerank: bool = True,
    ) -> dict:
        async def search(embedding: list[float]) -> list[dict]:
            return await self.db.search_paper_chunks(
                openalex_id,
                embedding,
                match_count=settings.retrieval_candidate_count,
                embedding_model=settings.embedding_model,
            )

        return await self._search("paper", query, limit, search, billing_ip=billing_ip, use_rerank=use_rerank)

    async def search_graph(
        self,
        openalex_ids: list[str],
        query: str,
        *,
        limit: int = 6,
        billing_ip: str | None = None,
        use_rerank: bool = True,
    ) -> dict:
        known_ids = list(dict.fromkeys(openalex_ids))[:25]
        if not known_ids:
            return {"scope": "graph", "query": query, "matches": []}

        async def search(embedding: list[float]) -> list[dict]:
            return await self.db.search_graph_paper_chunks(
                known_ids,
                embedding,
                match_count=settings.retrieval_candidate_count,
                embedding_model=settings.embedding_model,
            )

        return await self._search("graph", query, limit, search, billing_ip=billing_ip, use_rerank=use_rerank)

    async def _search(
        self,
        scope: str,
        query: str,
        limit: int,
        search: SearchFunction,
        *,
        billing_ip: str | None = None,
        use_rerank: bool = True,
    ) -> dict:
        final_limit = min(max(limit, 1), max(settings.retrieval_context_count, 1))
        try:
            embeddings = await embed_texts([query], input_type="query", billing_ip=billing_ip)
        except VoyageError as exc:
            raise RetrievalError(str(exc)) from exc
        if len(embeddings) != 1:
            raise RetrievalError("Query embedding provider returned an invalid response.")

        candidates = await search(embeddings[0])
        if not candidates:
            return {"scope": scope, "query": query, "matches": []}

        rerank_scores: dict[int, float] = {}
        ordered_indexes = list(range(min(final_limit, len(candidates))))
        documents = [self._rerank_document(candidate) for candidate in candidates]
        if use_rerank:
            try:
                ranked = await rerank(query, documents, top_k=final_limit, billing_ip=billing_ip)
                if ranked:
                    ordered_indexes = [result.index for result in ranked]
                    rerank_scores = {result.index: result.relevance_score for result in ranked}
            except VoyageError as exc:
                logger.warning("Reranking failed; using vector order", exc_info=exc)

        matches = [
            self._format_match(candidates[index], rerank_scores.get(index))
            for index in ordered_indexes[:final_limit]
        ]
        return {"scope": scope, "query": query, "matches": matches}

    def _rerank_document(self, candidate: dict) -> str:
        metadata = candidate.get("metadata") if isinstance(candidate.get("metadata"), dict) else {}
        title = str(metadata.get("title") or candidate.get("openalex_id") or "Paper")
        section = str(candidate.get("section") or "Body")
        return f"{title}\nSection: {section}\n\n{candidate.get('content') or ''}"

    def _format_match(self, candidate: dict, rerank_score: float | None) -> dict:
        metadata = candidate.get("metadata") if isinstance(candidate.get("metadata"), dict) else {}
        openalex_id = str(candidate.get("openalex_id") or "")
        document_id = str(candidate.get("document_id") or "")
        chunk_index = int(candidate.get("chunk_index") or 0)
        return {
            "content": str(candidate.get("content") or ""),
            "citation": {
                "id": f"paper:{openalex_id}:document:{document_id}:chunk:{chunk_index}",
                "openalexId": openalex_id,
                "title": str(metadata.get("title") or openalex_id),
                "section": str(candidate.get("section") or "Body"),
                "pageStart": candidate.get("page_start"),
                "pageEnd": candidate.get("page_end"),
                "chunkIndex": chunk_index,
                "sourceType": str(candidate.get("source_type") or "unknown"),
                "sourceUrl": candidate.get("source_url"),
            },
            "vectorScore": float(candidate.get("similarity") or 0.0),
            "rerankScore": rerank_score,
        }
