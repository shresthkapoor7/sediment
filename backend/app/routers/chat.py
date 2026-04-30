import logging

from fastapi import APIRouter, HTTPException, Request
from pydantic import ValidationError

from ..config import settings
from ..models import (
    MAX_TIMELINE_PAPERS,
    ChatRequest,
    ChatResponse,
    GlobalChatRequest,
    GlobalChatResponse,
    PaperSummary,
)
from ..services.llm import LLMClient, LLMParseError
from ..services.usage_limiter import limiter
from .search import get_request_ip

router = APIRouter()
logger = logging.getLogger(__name__)

_llm = LLMClient(api_key=settings.anthropic_api_key, model=settings.llm_model)


@router.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest, request: Request):
    if not req.question.strip():
        raise HTTPException(status_code=400, detail="question required")

    request_ip = get_request_ip(request)
    await limiter.claim_request(request_ip, "chat")

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
            ip=request_ip,
        )
    except LLMParseError as e:
        logger.warning("Paper chat failed for paper_id=%r", req.paperId, exc_info=e)
        raise HTTPException(status_code=502, detail="Chat service returned an invalid response.") from e

    try:
        return ChatResponse(**result)
    except ValidationError as e:
        logger.warning("Paper chat produced invalid payload for paper_id=%r", req.paperId, exc_info=e)
        raise HTTPException(status_code=502, detail="Chat service returned an invalid payload.") from e


@router.post("/chat/global/suggestions", response_model=list[str])
async def suggest_questions(papers: list[PaperSummary], request: Request):
    if not papers:
        return []
    if len(papers) > MAX_TIMELINE_PAPERS:
        raise HTTPException(status_code=400, detail=f"At most {MAX_TIMELINE_PAPERS} papers are allowed.")
    request_ip = get_request_ip(request)
    await limiter.claim_request(request_ip, "chat_global_suggestions")
    try:
        return await _llm.suggest_timeline_questions([p.model_dump() for p in papers], ip=request_ip)
    except LLMParseError as e:
        logger.warning("Timeline suggestion generation failed for %s papers", len(papers), exc_info=e)
        return []


@router.post("/chat/global", response_model=GlobalChatResponse)
async def chat_global(req: GlobalChatRequest, request: Request):
    if not req.question.strip():
        raise HTTPException(status_code=400, detail="question required")
    if not req.papers:
        raise HTTPException(status_code=400, detail="papers required")

    request_ip = get_request_ip(request)
    await limiter.claim_request(request_ip, "chat_global")

    try:
        result = await _llm.chat_about_timeline(
            [p.model_dump() for p in req.papers],
            req.question.strip(),
            ip=request_ip,
        )
    except LLMParseError as e:
        logger.warning("Timeline chat failed for %s papers", len(req.papers), exc_info=e)
        raise HTTPException(status_code=502, detail="Timeline chat service returned an invalid response.") from e

    try:
        return GlobalChatResponse(**result)
    except ValidationError as e:
        logger.warning("Timeline chat produced invalid payload for %s papers", len(req.papers), exc_info=e)
        raise HTTPException(status_code=502, detail="Timeline chat service returned an invalid payload.") from e
