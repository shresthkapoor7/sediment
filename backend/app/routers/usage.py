from fastapi import APIRouter, Request

from .search import _get_ip
from ..services.usage_limiter import limiter, HARD_LIMIT_USD

router = APIRouter()


@router.get("/usage")
async def get_usage(request: Request):
    ip = _get_ip(request)
    used = limiter.get(ip)
    remaining = max(0.0, HARD_LIMIT_USD - used)
    segments = round(remaining / HARD_LIMIT_USD * 10)
    return {"used": round(used, 6), "remaining": round(remaining, 6), "segments": segments}
