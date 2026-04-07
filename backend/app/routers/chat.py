from fastapi import APIRouter, HTTPException

from ..config import settings
from ..models import ChatRequest, ChatResponse
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

    return ChatResponse(**result)
