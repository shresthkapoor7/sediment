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
            "?select=id,user_id,query,data,metadata,seed_paper_id,is_public,share_id,created_at,updated_at"
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
            "&order=updated_at.desc"
        )
        return await self._request("GET", query)

    async def _request(
        self,
        method: str,
        path: str,
        *,
        json: dict[str, Any] | None = None,
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
