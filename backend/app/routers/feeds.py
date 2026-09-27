from __future__ import annotations

import asyncio
import logging
from typing import Literal, Optional
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field

from ..db.supabase import SupabaseAPIError, SupabaseConfigError
from ..services.feeds import FeedService
from ..services.usage_limiter import limiter
from .search import get_request_ip

router = APIRouter()
logger = logging.getLogger(__name__)


class FeedRequest(BaseModel):
    userId: UUID
    action: Literal['interests', 'refresh', 'more', 'source']
    source: Literal['all', 'arxiv', 'huggingface', 'openalex'] = 'all'
    interests: Optional[str] = Field(default=None, min_length=1, max_length=600)
    cursor: Optional[str] = Field(default=None, max_length=300)


@router.get('/feeds')
async def get_feed(userId: UUID, response: Response):
    response.headers['Cache-Control'] = 'no-store'
    try:
        return await FeedService().read(str(userId))
    except (SupabaseAPIError, SupabaseConfigError):
        logger.warning('Feed persistence unavailable')
        raise HTTPException(503, 'Feed storage is unavailable. Please try again later.') from None


@router.post('/feeds')
async def update_feed(body: FeedRequest, request: Request, response: Response):
    response.headers['Cache-Control'] = 'no-store'
    if body.action == 'interests' and not (body.interests or '').strip():
        raise HTTPException(400, 'Describe your research interests first.')
    if body.action != 'interests' and body.interests is not None:
        raise HTTPException(400, 'Use Edit interests to change your interests.')
    if body.action in ('interests', 'refresh') and body.source != 'all':
        raise HTTPException(400, 'Refresh and interest changes apply to all sources.')
    try:
        await limiter.claim_request(get_request_ip(request), 'feeds')
        return await asyncio.wait_for(FeedService().mutate(str(body.userId), body.action, body.interests, body.cursor, body.source), timeout=165)
    except (SupabaseAPIError, SupabaseConfigError):
        logger.warning('Feed persistence unavailable')
        raise HTTPException(503, 'Feed storage is unavailable. Please try again later.') from None
    except asyncio.TimeoutError:
        raise HTTPException(504, 'Feed update took too long. Please retry.') from None
    except RuntimeError:
        raise HTTPException(409, 'Feed update could not finish. Please retry.') from None
