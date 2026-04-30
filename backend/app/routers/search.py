import logging

from fastapi import APIRouter, HTTPException

from ..models import LineageGraphResponse, SearchRequest
from ..services.llm import LLMClient, LLMParseError
from ..services.openalex import OpenAlexClient, OpenAlexError
from ..services.lineage import trace_lineage
from ..config import settings

router = APIRouter()
logger = logging.getLogger(__name__)

# Singletons — created once, reused per request
_llm = LLMClient(api_key=settings.anthropic_api_key, model=settings.llm_model)


@router.post("/search", response_model=LineageGraphResponse)
async def search(req: SearchRequest):
    if not req.query.strip():
        raise HTTPException(status_code=400, detail="query required")

    try:
        async with OpenAlexClient(
            api_key=settings.openalex_api_key,
            mailto=settings.openalex_mailto,
        ) as openalex:
            graph = await trace_lineage(
                req.query.strip(),
                openalex,
                _llm,
                seed_openalex_id=req.seedOpenalexId,
                settings=req.settings,
            )
    except LLMParseError as e:
        logger.warning("Search failed due to LLM parse error for query=%r", req.query, exc_info=e)
        raise HTTPException(status_code=502, detail="Search service returned an invalid response.") from e
    except OpenAlexError as e:
        logger.warning("Search failed due to OpenAlex error for query=%r", req.query, exc_info=e)
        raise HTTPException(status_code=502, detail="Search data provider is currently unavailable.") from e

    return LineageGraphResponse(**graph)
