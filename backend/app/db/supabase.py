from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote

import aiohttp

from ..config import settings


class SupabaseConfigError(RuntimeError):
    pass


class SupabaseAPIError(RuntimeError):
    pass


class SupabaseClient:
    def __init__(self):
        if not settings.supabase_url or not settings.supabase_service_role_key.get_secret_value():
            raise SupabaseConfigError(
                "Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
            )

        self.base_url = settings.supabase_url.rstrip("/")
        service_role_key = settings.supabase_service_role_key.get_secret_value()
        self.headers = {
            "apikey": service_role_key,
            "Authorization": f"Bearer {service_role_key}",
            "Content-Type": "application/json",
        }

    async def upsert_user(self, user_id: str) -> dict[str, Any]:
        payload = {"id": user_id, "last_seen": datetime.now(timezone.utc).isoformat()}
        return await self._request(
            "POST",
            "/rest/v1/users?on_conflict=id",
            json=payload,
            headers={"Prefer": "resolution=merge-duplicates,return=representation"},
            expect_single=True,
        )

    async def create_graph(self, payload: dict[str, Any]) -> dict[str, Any]:
        return await self._request(
            "POST",
            "/rest/v1/graphs",
            json=payload,
            headers={"Prefer": "return=representation"},
            expect_single=True,
        )

    async def update_graph(self, graph_id: str, user_id: str, payload: dict[str, Any]) -> dict[str, Any] | None:
        query = (
            "/rest/v1/graphs"
            f"?id=eq.{quote(graph_id, safe='')}"
            f"&user_id=eq.{quote(user_id, safe='')}"
            "&deleted_at=is.null"
        )
        return await self._request(
            "PATCH",
            query,
            json=payload,
            headers={"Prefer": "return=representation"},
            expect_single=True,
            allow_empty=True,
        )

    async def get_graph(self, graph_id: str, user_id: str) -> dict[str, Any] | None:
        query = (
            "/rest/v1/graphs"
            "?select=id,user_id,query,data,metadata,seed_paper_id,is_public,share_id,created_at,updated_at"
            f"&id=eq.{quote(graph_id, safe='')}"
            f"&user_id=eq.{quote(user_id, safe='')}"
            "&deleted_at=is.null"
            "&limit=1"
        )
        return await self._request("GET", query, expect_single=True, allow_empty=True)

    async def share_graph(self, graph_id: str, user_id: str, share_id: str) -> dict[str, Any] | None:
        query = (
            "/rest/v1/graphs"
            f"?id=eq.{quote(graph_id, safe='')}"
            f"&user_id=eq.{quote(user_id, safe='')}"
        )
        return await self._request(
            "PATCH",
            query,
            json={"share_id": share_id, "is_public": True},
            headers={"Prefer": "return=representation"},
            expect_single=True,
            allow_empty=True,
        )

    async def get_graph_by_share_id(self, share_id: str) -> dict[str, Any] | None:
        query = (
            "/rest/v1/graphs"
            "?select=id,query,data,metadata,seed_paper_id,is_public,share_id,created_at,updated_at"
            f"&share_id=eq.{quote(share_id, safe='')}"
            "&is_public=eq.true"
            "&limit=1"
        )
        return await self._request("GET", query, expect_single=True, allow_empty=True)

    async def list_graphs(self, user_id: str) -> list[dict[str, Any]]:
        query = (
            "/rest/v1/graphs"
            "?select=id,query,metadata,seed_paper_id,created_at,updated_at"
            f"&user_id=eq.{quote(user_id, safe='')}"
            "&deleted_at=is.null"
            "&order=updated_at.desc"
        )
        return await self._request("GET", query)

    async def soft_delete_graph(self, graph_id: str, user_id: str) -> dict[str, Any] | None:
        query = (
            "/rest/v1/graphs"
            f"?id=eq.{quote(graph_id, safe='')}"
            f"&user_id=eq.{quote(user_id, safe='')}"
            "&deleted_at=is.null"
        )
        payload = {"deleted_at": datetime.now(timezone.utc).isoformat()}
        return await self._request(
            "PATCH",
            query,
            json=payload,
            headers={"Prefer": "return=representation"},
            expect_single=True,
            allow_empty=True,
        )

    async def list_changelogs(self, limit: int = 50) -> list[dict[str, Any]]:
        query = (
            "/rest/v1/changelogs"
            "?select=id,pr_number,title,summary,merged_at,author,pr_url"
            "&order=merged_at.desc"
            f"&limit={limit}"
        )
        return await self._request("GET", query)

    async def get_or_create_chat_session(
        self,
        graph_id: str,
        user_id: str,
        scope: str,
        paper_openalex_id: str | None = None,
    ) -> dict[str, Any]:
        return await self.rpc(
            "get_or_create_chat_session",
            {
                "p_graph_id": graph_id,
                "p_user_id": user_id,
                "p_scope": scope,
                "p_paper_openalex_id": paper_openalex_id,
            },
            expect_single=True,
        )

    async def list_chat_messages(
        self,
        session_id: str,
        user_id: str,
        *,
        limit: int = 24,
    ) -> list[dict[str, Any]]:
        safe_limit = min(max(limit, 1), 100)
        session_query = (
            "/rest/v1/chat_sessions"
            "?select=id,graphs!inner(user_id,deleted_at)"
            f"&id=eq.{quote(session_id, safe='')}"
            f"&user_id=eq.{quote(user_id, safe='')}"
            f"&graphs.user_id=eq.{quote(user_id, safe='')}"
            "&graphs.deleted_at=is.null"
            "&limit=1"
        )
        session = await self._request("GET", session_query, expect_single=True, allow_empty=True)
        if not session:
            return []

        messages_query = (
            "/rest/v1/chat_messages"
            "?select=id,session_id,role,content,tool_uses,citations,sequence_number,created_at"
            f"&session_id=eq.{quote(session_id, safe='')}"
            "&order=sequence_number.desc"
            f"&limit={safe_limit}"
        )
        rows = await self._request("GET", messages_query)
        return list(reversed(rows))

    async def list_chat_messages_range(
        self,
        session_id: str,
        user_id: str,
        *,
        after_sequence: int = 0,
        through_sequence: int | None = None,
        limit: int = 40,
    ) -> list[dict[str, Any]]:
        session_query = (
            "/rest/v1/chat_sessions"
            "?select=id,graphs!inner(user_id,deleted_at)"
            f"&id=eq.{quote(session_id, safe='')}"
            f"&user_id=eq.{quote(user_id, safe='')}"
            f"&graphs.user_id=eq.{quote(user_id, safe='')}"
            "&graphs.deleted_at=is.null"
            "&limit=1"
        )
        session = await self._request("GET", session_query, expect_single=True, allow_empty=True)
        if not session:
            return []

        safe_limit = min(max(limit, 1), 100)
        messages_query = (
            "/rest/v1/chat_messages"
            "?select=id,session_id,role,content,tool_uses,citations,sequence_number,created_at"
            f"&session_id=eq.{quote(session_id, safe='')}"
            f"&sequence_number=gt.{max(after_sequence, 0)}"
            + (f"&sequence_number=lte.{through_sequence}" if through_sequence is not None else "")
            + "&order=sequence_number.asc"
            + f"&limit={safe_limit}"
        )
        return await self._request("GET", messages_query)

    async def append_chat_message(
        self,
        session_id: str,
        user_id: str,
        role: str,
        content: str,
        *,
        tool_uses: list[dict[str, Any]] | None = None,
        citations: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        return await self.rpc(
            "append_chat_message",
            {
                "p_session_id": session_id,
                "p_user_id": user_id,
                "p_role": role,
                "p_content": content,
                "p_tool_uses": tool_uses,
                "p_citations": citations,
            },
            expect_single=True,
        )

    async def update_chat_session_summary(
        self,
        session_id: str,
        user_id: str,
        summary: str,
        through_sequence: int,
    ) -> dict[str, Any]:
        return await self.rpc(
            "update_chat_session_summary",
            {
                "p_session_id": session_id,
                "p_user_id": user_id,
                "p_summary": summary,
                "p_through_sequence": through_sequence,
            },
            expect_single=True,
        )

    async def get_ready_paper_document(self, openalex_id: str) -> dict[str, Any] | None:
        query = (
            "/rest/v1/paper_documents"
            "?select=id,openalex_id,doi,source_type,source_url,license,access_status,"
            "ingestion_status,checksum,parser,parser_version,embedding_model,"
            "embedding_dimensions,chunk_count,fetched_at,created_at,updated_at"
            f"&openalex_id=eq.{quote(openalex_id, safe='')}"
            "&ingestion_status=eq.ready"
            "&order=created_at.desc"
            "&limit=1"
        )
        return await self._request("GET", query, expect_single=True, allow_empty=True)

    async def prepare_paper_ingestion(self, payload: dict[str, Any]) -> dict[str, Any]:
        return await self.rpc("prepare_paper_ingestion", payload, expect_single=True)

    async def set_paper_ingestion_status(
        self,
        document_id: str,
        status: str,
        error_code: str | None = None,
    ) -> None:
        await self.rpc(
            "set_paper_ingestion_status",
            {
                "p_document_id": document_id,
                "p_status": status,
                "p_error_code": error_code,
            },
        )

    async def replace_paper_chunks(self, document_id: str, chunks: list[dict[str, Any]]) -> None:
        delete_query = (
            "/rest/v1/paper_chunks"
            f"?document_id=eq.{quote(document_id, safe='')}"
        )
        await self._request("DELETE", delete_query, allow_empty=True)
        for start in range(0, len(chunks), 50):
            await self._request(
                "POST",
                "/rest/v1/paper_chunks",
                json=chunks[start:start + 50],
                headers={"Prefer": "return=minimal"},
                allow_empty=True,
            )

    async def complete_paper_ingestion(self, document_id: str) -> dict[str, Any]:
        return await self.rpc(
            "complete_paper_ingestion",
            {"p_document_id": document_id},
            expect_single=True,
        )

    async def search_paper_chunks(
        self,
        openalex_id: str,
        query_embedding: list[float],
        *,
        match_count: int = 20,
        min_similarity: float = 0.0,
        embedding_model: str = "voyage-4",
    ) -> list[dict[str, Any]]:
        return await self.rpc(
            "search_paper_chunks",
            {
                "p_query_embedding": query_embedding,
                "p_openalex_id": openalex_id,
                "p_match_count": min(max(match_count, 1), 50),
                "p_min_similarity": min(max(min_similarity, -1.0), 1.0),
                "p_embedding_model": embedding_model,
            },
        )

    async def search_graph_paper_chunks(
        self,
        openalex_ids: list[str],
        query_embedding: list[float],
        *,
        match_count: int = 20,
        min_similarity: float = 0.0,
        embedding_model: str = "voyage-4",
    ) -> list[dict[str, Any]]:
        return await self.rpc(
            "search_graph_paper_chunks",
            {
                "p_query_embedding": query_embedding,
                "p_openalex_ids": openalex_ids,
                "p_match_count": min(max(match_count, 1), 50),
                "p_min_similarity": min(max(min_similarity, -1.0), 1.0),
                "p_embedding_model": embedding_model,
            },
        )

    async def rpc(self, function_name: str, params: dict[str, Any], *, expect_single: bool = False) -> Any:
        return await self._request(
            "POST",
            f"/rest/v1/rpc/{quote(function_name, safe='')}",
            json=params,
            expect_single=expect_single,
        )

    async def _request(
        self,
        method: str,
        path: str,
        *,
        json: Any = None,
        headers: dict[str, str] | None = None,
        expect_single: bool = False,
        allow_empty: bool = False,
    ) -> Any:
        request_headers = {**self.headers, **(headers or {})}
        async with aiohttp.ClientSession(headers=request_headers) as session:
            async with session.request(method, f"{self.base_url}{path}", json=json) as response:
                text = await response.text()
                if response.status >= 400:
                    raise SupabaseAPIError(f"Supabase request failed ({response.status}): {text}")

                if not text:
                    return None if allow_empty else {}

                data = await response.json()
                if expect_single:
                    if isinstance(data, list):
                        if not data:
                            return None if allow_empty else {}
                        return data[0]
                    return data

                return data
