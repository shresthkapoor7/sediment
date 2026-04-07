from fastapi import APIRouter, Depends, HTTPException
from ..models import SearchRequest, LineageResponse, LLMPaper
from ..services.semantic_scholar import SemanticScholarClient
from ..services.llm import LLMClient
from ..services.lineage import trace_lineage
from ..config import settings

router = APIRouter()


def get_s2():
    return SemanticScholarClient(api_key=settings.semantic_scholar_api_key)


def get_llm():
    return LLMClient(api_key=settings.anthropic_api_key)


@router.post("/search", response_model=LineageResponse)
async def search(req: SearchRequest):
    if not req.query.strip():
        raise HTTPException(status_code=400, detail="query required")

    s2 = get_s2()
    llm = get_llm()

    papers = await trace_lineage(req.query.strip(), s2, llm)

    return LineageResponse(papers=[LLMPaper(**p) for p in papers])
