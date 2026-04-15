from fastapi import APIRouter, HTTPException, Request
from ..models import LineageGraphResponse, SearchRequest
from ..services.llm import LLMClient, LLMParseError
from ..services.openalex import OpenAlexClient, OpenAlexError
from ..services.lineage import trace_lineage
from ..config import settings

router = APIRouter()

# Singletons — created once, reused per request
_llm = LLMClient(api_key=settings.anthropic_api_key, model=settings.llm_model)


def _get_ip(request: Request) -> str:
    forwarded_for = request.headers.get("X-Forwarded-For")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    real_ip = request.headers.get("X-Real-IP")
    if real_ip:
        return real_ip.strip()
    return request.client.host if request.client else "unknown"


@router.post("/search", response_model=LineageGraphResponse)
async def search(req: SearchRequest, request: Request):
    if not req.query.strip():
        raise HTTPException(status_code=400, detail="query required")

    ip = _get_ip(request)
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
                ip=ip,
            )
    except LLMParseError as e:
        raise HTTPException(status_code=502, detail=f"LLM error: {e}") from e
    except OpenAlexError as e:
        raise HTTPException(status_code=502, detail=f"OpenAlex error: {e}") from e

    return LineageGraphResponse(**graph)
