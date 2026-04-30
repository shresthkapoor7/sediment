from __future__ import annotations

import hashlib
import hmac
import logging

from fastapi import HTTPException

from ..config import settings
from ..db.supabase import SupabaseAPIError, SupabaseClient, SupabaseConfigError

logger = logging.getLogger(__name__)

MICRO_USD_PER_USD = 1_000_000
SEGMENTS = 10
_MODEL_PRICING_USD_PER_MILLION: dict[str, dict[str, float]] = {
    "claude-haiku-4-5-20251001": {"input": 1.00, "output": 5.00},
    "claude-3-5-haiku-20241022": {"input": 0.80, "output": 4.00},
    "claude-sonnet-4-6": {"input": 3.00, "output": 15.00},
    "claude-opus-4-6": {"input": 15.00, "output": 75.00},
}
_DEFAULT_PRICING_USD_PER_MILLION: dict[str, float] = {"input": 3.00, "output": 15.00}


def _micro_usd_to_usd(micro_usd: int) -> float:
    return micro_usd / MICRO_USD_PER_USD


def _usd_to_micro_usd(usd: float) -> int:
    return int(round(usd * MICRO_USD_PER_USD))


def _normalize_ip(ip: str) -> str:
    stripped = ip.strip()
    return stripped or "unknown"


def _actor_secret() -> bytes:
    return settings.actor_key_secret.get_secret_value().encode("utf-8")


def _actor_key(ip: str) -> str:
    normalized_ip = _normalize_ip(ip).encode("utf-8")
    digest = hmac.new(_actor_secret(), normalized_ip, hashlib.sha256).hexdigest()
    return f"iphash:{digest}"


class UsageLimiter:
    def __init__(self) -> None:
        self._daily_limit_micro_usd = _usd_to_micro_usd(settings.daily_usage_limit_usd)

    def _db(self) -> SupabaseClient:
        try:
            return SupabaseClient()
        except SupabaseConfigError as e:
            logger.error("Supabase is required for usage limiting", exc_info=e)
            raise HTTPException(status_code=503, detail="Usage limiter is unavailable.") from e

    async def claim_request(self, ip: str, endpoint: str) -> dict:
        actor_key = _actor_key(ip)
        try:
            result = await self._db().rpc(
                "claim_api_request_slot",
                {
                    "p_actor_key": actor_key,
                    "p_endpoint": endpoint,
                    "p_daily_limit_microusd": self._daily_limit_micro_usd,
                    "p_burst_limit": settings.burst_limit_requests,
                    "p_window_seconds": settings.burst_limit_window_seconds,
                },
                expect_single=True,
            )
        except SupabaseAPIError as e:
            message = str(e)
            if "DAILY_LIMIT_EXCEEDED" in message:
                raise HTTPException(
                    status_code=429,
                    detail=f"Daily usage limit of ${settings.daily_usage_limit_usd:.2f} reached.",
                ) from e
            if "BURST_LIMIT_EXCEEDED" in message:
                raise HTTPException(
                    status_code=429,
                    detail="Too many requests in a short time. Please wait a moment and try again.",
                ) from e
            logger.warning("Usage claim failed for actor_key=%r endpoint=%r", actor_key, endpoint, exc_info=e)
            raise HTTPException(status_code=503, detail="Usage limiter is unavailable.") from e

        return result if isinstance(result, dict) else {}

    async def record_usage(self, ip: str, input_tokens: int, output_tokens: int, model: str) -> dict:
        cost_micro_usd = self.cost_micro_usd(input_tokens, output_tokens, model)
        actor_key = _actor_key(ip)
        try:
            result = await self._db().rpc(
                "record_api_usage",
                {
                    "p_actor_key": actor_key,
                    "p_cost_microusd": cost_micro_usd,
                },
                expect_single=True,
            )
        except SupabaseAPIError as e:
            logger.warning("Usage recording failed for actor_key=%r", actor_key, exc_info=e)
            raise HTTPException(status_code=503, detail="Usage recording failed.") from e
        return result if isinstance(result, dict) else {}

    async def get_summary(self, ip: str) -> dict[str, float | int]:
        actor_key = _actor_key(ip)
        try:
            result = await self._db().rpc(
                "get_api_usage_summary",
                {
                    "p_actor_key": actor_key,
                    "p_daily_limit_microusd": self._daily_limit_micro_usd,
                },
                expect_single=True,
            )
        except SupabaseAPIError as e:
            logger.warning("Usage summary failed for actor_key=%r", actor_key, exc_info=e)
            raise HTTPException(status_code=503, detail="Usage summary is unavailable.") from e

        used_micro_usd = int(result.get("used_microusd", 0)) if isinstance(result, dict) else 0
        remaining_micro_usd = int(result.get("remaining_microusd", self._daily_limit_micro_usd)) if isinstance(result, dict) else self._daily_limit_micro_usd
        request_count = int(result.get("request_count", 0)) if isinstance(result, dict) else 0
        segments = max(0, min(SEGMENTS, round((remaining_micro_usd / max(1, self._daily_limit_micro_usd)) * SEGMENTS)))
        return {
            "used": round(_micro_usd_to_usd(used_micro_usd), 6),
            "remaining": round(_micro_usd_to_usd(remaining_micro_usd), 6),
            "segments": segments,
            "requestCount": request_count,
            "dailyLimit": settings.daily_usage_limit_usd,
        }

    @staticmethod
    def cost_micro_usd(input_tokens: int, output_tokens: int, model: str) -> int:
        pricing = _MODEL_PRICING_USD_PER_MILLION.get(model, _DEFAULT_PRICING_USD_PER_MILLION)
        cost_usd = (input_tokens * pricing["input"] + output_tokens * pricing["output"]) / 1_000_000
        return _usd_to_micro_usd(cost_usd)


limiter = UsageLimiter()
