from __future__ import annotations

from typing import Optional, List

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..db.supabase import SupabaseClient, SupabaseConfigError, SupabaseAPIError

router = APIRouter(prefix="/changelog", tags=["changelog"])


class ChangelogEntry(BaseModel):
    id: str
    pr_number: int
    title: str
    summary: Optional[str]
    merged_at: str
    author: str
    pr_url: str


class ChangelogResponse(BaseModel):
    entries: List[ChangelogEntry]
    nextOffset: Optional[int] = None
    hasMore: bool = False


@router.get("", response_model=ChangelogResponse)
async def list_changelogs(limit: int = 10, offset: int = 0):
    try:
        client = SupabaseClient()
        clamped_limit = max(1, min(limit, 50))
        clamped_offset = max(offset, 0)
        rows = await client.list_changelogs(limit=clamped_limit + 1, offset=clamped_offset)
        entries = rows[:clamped_limit]
        return ChangelogResponse(
            entries=entries,
            hasMore=len(rows) > clamped_limit,
            nextOffset=clamped_offset + len(entries) if len(rows) > clamped_limit else None,
        )
    except SupabaseConfigError:
        raise HTTPException(status_code=503, detail="Database not configured") from None
    except SupabaseAPIError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
