from fastapi import APIRouter, Depends, Response

from ..actor import Actor, current_actor
from ..services.usage_limiter import limiter

router = APIRouter()


@router.get("/usage")
async def get_usage(response: Response, actor: Actor = Depends(current_actor)):
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    return await limiter.get_summary(actor.usage_key)
