from __future__ import annotations

import asyncio
import logging
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field

from ..db.supabase import SupabaseAPIError, SupabaseConfigError
from ..services.feeds import FeedService
from ..services.feed_domains import Domain
from ..services.feed_identity import issue_feed_credential, require_feed_actor
from ..services.usage_limiter import limiter
from .search import get_request_ip

router = APIRouter()
logger = logging.getLogger(__name__)


class FeedRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    action: Literal['interests', 'refresh', 'more', 'source']
    domain: Optional[Domain] = None
    source: Literal['all', 'arxiv', 'huggingface', 'openalex', 'biorxiv', 'medrxiv', 'journals', 'repositories'] = 'all'
    interests: Optional[str] = Field(default=None, min_length=1, max_length=600)
    cursor: Optional[str] = Field(default=None, max_length=300)


@router.post('/feed-session')
async def create_feed_session(response: Response):
    response.headers['Cache-Control'] = 'no-store'
    return {'token': issue_feed_credential()}


@router.get('/feeds')
async def get_feed(request: Request, response: Response, actor: str = Depends(require_feed_actor)):
    response.headers['Cache-Control'] = 'no-store'
    try:
        if 'userId' in request.query_params:
            raise HTTPException(400, 'Feed identity is determined by the session credential.')
        return await FeedService().read(actor)
    except (SupabaseAPIError, SupabaseConfigError):
        logger.warning('Feed persistence unavailable')
        raise HTTPException(503, 'Feed storage is unavailable. Please try again later.') from None


@router.post('/feeds')
async def update_feed(body: FeedRequest, request: Request, response: Response, actor: str = Depends(require_feed_actor)):
    response.headers['Cache-Control'] = 'no-store'
    if body.action == 'interests' and not (body.interests or '').strip():
        raise HTTPException(400, 'Describe your research interests first.')
    if body.action != 'interests' and body.domain is not None:
        raise HTTPException(400, 'Use Edit interests to change your domain.')
    if body.action != 'interests' and body.interests is not None:
        raise HTTPException(400, 'Use Edit interests to change your interests.')
    if body.action in ('interests', 'refresh') and body.source != 'all':
        raise HTTPException(400, 'Refresh and interest changes apply to all sources.')
    try:
        await limiter.claim_request(get_request_ip(request), 'feeds')
        return await asyncio.wait_for(FeedService().mutate(actor, body.action, body.interests, body.cursor, body.source, **({"domain": body.domain} if body.domain is not None else {})), timeout=165)
    except (SupabaseAPIError, SupabaseConfigError):
        logger.warning('Feed persistence unavailable')
        raise HTTPException(503, 'Feed storage is unavailable. Please try again later.') from None
    except asyncio.TimeoutError:
        raise HTTPException(504, 'Feed update took too long. Please retry.') from None
    except RuntimeError:
        raise HTTPException(409, 'Feed update could not finish. Please retry.') from None


@router.get('/feed-papers/{paper_id}')
async def get_feed_paper(paper_id: str, response: Response):
    response.headers['Cache-Control'] = 'no-store'
    try:
        return await FeedService().paper(paper_id)
    except (SupabaseAPIError, SupabaseConfigError):
        raise HTTPException(503, 'Paper details are unavailable. Please try again later.') from None
