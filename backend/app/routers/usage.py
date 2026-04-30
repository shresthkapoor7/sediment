from fastapi import APIRouter, Request

from ..services.usage_limiter import limiter
from .search import get_request_ip

router = APIRouter()


@router.get("/usage")
async def get_usage(request: Request):
    return await limiter.get_summary(get_request_ip(request))
