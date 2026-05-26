import logging

from fastapi import APIRouter, Request

from ..models import ClarifyRequest, ClarifyResponse
from ..services.llm import LLMClient, LLMParseError
from ..services.usage_limiter import limiter
from ..config import settings

router = APIRouter()
logger = logging.getLogger(__name__)

_llm = LLMClient(api_key=settings.anthropic_api_key, model=settings.llm_model)


def _get_ip(request: Request) -> str:
    verified = getattr(request.state, "verified_client_ip", None)
    if isinstance(verified, str) and verified.strip():
        return verified.strip()
    return request.client.host if request.client else "unknown"


@router.post("/clarify", response_model=ClarifyResponse)
async def clarify(req: ClarifyRequest, request: Request):
    await limiter.claim_request(_get_ip(request), "clarify")
    try:
        result = await _llm.clarify_query(req.query.strip(), ip=_get_ip(request))
    except LLMParseError:
        return ClarifyResponse(needs_clarification=False, refined_query=req.query.strip())

    return ClarifyResponse(**result)
