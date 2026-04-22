from fastapi import APIRouter, HTTPException, Request
from pydantic import ValidationError

from ..config import settings
from ..models import ExpandRequest, LineageGraphResponse
from ..services.lineage import expand_lineage
from ..services.llm import LLMClient, LLMParseError
from ..services.openalex import OpenAlexClient, OpenAlexError
from .search import _get_ip

router = APIRouter()

_llm = LLMClient(api_key=settings.anthropic_api_key, model=settings.llm_model)


@router.post("/expand", response_model=LineageGraphResponse)
async def expand(req: ExpandRequest, request: Request):
    if not req.paperId.strip():
        raise HTTPException(status_code=400, detail="paperId required")

    ip = _get_ip(request)
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
                ip=ip,
            )
    except LLMParseError as e:
        raise HTTPException(status_code=502, detail=f"LLM error: {e}") from e
    except OpenAlexError as e:
        raise HTTPException(status_code=502, detail=f"OpenAlex error: {e}") from e

    try:
        return LineageGraphResponse(**graph)
    except ValidationError as e:
        raise HTTPException(status_code=502, detail=f"Validation error: {e}") from e
