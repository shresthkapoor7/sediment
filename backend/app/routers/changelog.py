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


@router.get("", response_model=ChangelogResponse)
async def list_changelogs(limit: int = 50):
    try:
        client = SupabaseClient()
        clamped_limit = max(1, min(limit, 100))
        entries = await client.list_changelogs(limit=clamped_limit)
        return ChangelogResponse(entries=entries)
    except SupabaseConfigError:
        raise HTTPException(status_code=503, detail="Database not configured") from None
    except SupabaseAPIError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
