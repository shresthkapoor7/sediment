from fastapi import APIRouter, HTTPException
from ..models import SearchRequest, LineageResponse, LLMPaper
from ..services.semantic_scholar import SemanticScholarClient
from ..services.llm import LLMClient, LLMParseError
from ..services.lineage import trace_lineage
from ..config import settings

router = APIRouter()

# Singletons — created once, reused per request
_llm = LLMClient(api_key=settings.anthropic_api_key, model=settings.llm_model)


@router.post("/search", response_model=LineageResponse)
async def search(req: SearchRequest):
    if not req.query.strip():
        raise HTTPException(status_code=400, detail="query required")

    try:
        async with SemanticScholarClient(api_key=settings.semantic_scholar_api_key) as s2:
            papers = await trace_lineage(req.query.strip(), s2, _llm)
    except LLMParseError as e:
        raise HTTPException(status_code=502, detail=f"LLM error: {e}") from e

    return LineageResponse(papers=[LLMPaper(**p) for p in papers])
