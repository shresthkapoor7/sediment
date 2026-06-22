from fastapi import APIRouter, Request, Response

from ..services.usage_limiter import limiter
from .search import get_request_ip

router = APIRouter()


@router.get("/usage")
async def get_usage(request: Request, response: Response):
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    return await limiter.get_summary(get_request_ip(request))
