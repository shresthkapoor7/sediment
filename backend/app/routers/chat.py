from fastapi import APIRouter, HTTPException
from pydantic import ValidationError

from ..config import settings
from ..models import ChatRequest, ChatResponse, GlobalChatRequest, GlobalChatResponse, PaperSummary
from ..services.llm import LLMClient, LLMParseError

router = APIRouter()

_llm = LLMClient(api_key=settings.anthropic_api_key, model=settings.llm_model)


@router.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest):
    if not req.question.strip():
        raise HTTPException(status_code=400, detail="question required")

    try:
        result = await _llm.chat_about_paper(
            {
                "openalexId": req.paperId,
                "title": req.title,
                "year": req.year,
                "summary": req.summary,
                "authors": req.authors,
            },
            req.question.strip(),
        )
    except LLMParseError as e:
        raise HTTPException(status_code=502, detail=f"LLM error: {e}") from e

    try:
        return ChatResponse(**result)
    except ValidationError as e:
        raise HTTPException(status_code=502, detail=f"Validation error: {e}") from e


@router.post("/chat/global/suggestions", response_model=list[str])
async def suggest_questions(papers: list[PaperSummary]):
    if not papers:
        return []
    try:
        return await _llm.suggest_timeline_questions([p.model_dump() for p in papers])
    except LLMParseError:
        return []


@router.post("/chat/global", response_model=GlobalChatResponse)
async def chat_global(req: GlobalChatRequest):
    if not req.question.strip():
        raise HTTPException(status_code=400, detail="question required")
    if not req.papers:
        raise HTTPException(status_code=400, detail="papers required")

    try:
        result = await _llm.chat_about_timeline(
            [p.model_dump() for p in req.papers],
            req.question.strip(),
        )
    except LLMParseError as e:
        raise HTTPException(status_code=502, detail=f"LLM error: {e}") from e

    try:
        return GlobalChatResponse(**result)
    except ValidationError as e:
        raise HTTPException(status_code=502, detail=f"Validation error: {e}") from e
