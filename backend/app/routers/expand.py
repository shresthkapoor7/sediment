import logging

from fastapi import APIRouter, HTTPException, Request
from pydantic import ValidationError

from ..config import settings
from ..models import ExpandRequest, LineageGraphResponse
from ..services.lineage import expand_lineage
from ..services.llm import LLMClient, LLMParseError
from ..services.openalex import OpenAlexClient, OpenAlexError
from ..services.usage_limiter import limiter
from .search import get_request_ip

router = APIRouter()
logger = logging.getLogger(__name__)

_llm = LLMClient(api_key=settings.anthropic_api_key, model=settings.llm_model)


@router.post("/expand", response_model=LineageGraphResponse)
async def expand(req: ExpandRequest, request: Request):
    if not req.paperId.strip():
        raise HTTPException(status_code=400, detail="paperId required")

    request_ip = get_request_ip(request)
    await limiter.claim_request(request_ip, "expand")

    try:
        async with OpenAlexClient(
            api_key=settings.openalex_api_key,
            mailto=settings.openalex_mailto,
        ) as openalex:
            graph = await expand_lineage(
                req.paperId.strip(),
                req.conceptContext.strip(),
                openalex,
                _llm,
                settings=req.settings,
                ip=request_ip,
            )
    except LLMParseError as e:
        logger.warning("Expand failed due to LLM parse error for paper_id=%r", req.paperId, exc_info=e)
        raise HTTPException(status_code=502, detail="Expansion service returned an invalid response.") from e
    except OpenAlexError as e:
        logger.warning("Expand failed due to OpenAlex error for paper_id=%r", req.paperId, exc_info=e)
        raise HTTPException(status_code=502, detail="Expansion data provider is currently unavailable.") from e

    try:
        return LineageGraphResponse(**graph)
    except ValidationError as e:
        logger.warning("Expand produced invalid graph payload for paper_id=%r", req.paperId, exc_info=e)
        raise HTTPException(status_code=502, detail="Expansion service returned an invalid graph payload.") from e
