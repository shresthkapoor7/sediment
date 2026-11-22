from __future__ import annotations

import hashlib
import hmac
import logging
from typing import TYPE_CHECKING

from fastapi import HTTPException

from ..config import settings
from ..db.supabase import SupabaseAPIError, SupabaseClient, SupabaseConfigError

if TYPE_CHECKING:
    from ..actor import Actor

logger = logging.getLogger(__name__)

MICRO_USD_PER_USD = 1_000_000
SEGMENTS = 10
ANTHROPIC_WEB_SEARCH_MICRO_USD = 10_000
_MODEL_PRICING_USD_PER_MILLION: dict[str, dict[str, float]] = {
    "claude-haiku-5-5": {"input": 0.10, "output": 0.50},
    "claude-haiku-4-5-20251001": {"input": 1.00, "output": 5.00},
    "claude-3-5-haiku-20241022": {"input": 0.80, "output": 4.00},
    "claude-sonnet-4-6": {"input": 3.00, "output": 15.00},
    "claude-opus-4-6": {"input": 15.00, "output": 75.00},
}
_DEFAULT_PRICING_USD_PER_MILLION: dict[str, float] = {"input": 3.00, "output": 15.00}


def _micro_usd_to_usd(micro_usd: int) -> float:
    return micro_usd / MICRO_USD_PER_USD


def _usd_to_micro_usd(usd: float) -> int:
    return round(usd * MICRO_USD_PER_USD)


def _actor_secret() -> bytes:
    return settings.actor_key_secret.get_secret_value().encode("utf-8")


def _hashed(prefix: str, value: str) -> str:
    digest = hmac.new(_actor_secret(), (value.strip() or "unknown").encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{prefix}:{digest}"


def _actor_key(usage_key: str) -> str:
    """The stored key for an actor's usage. `usage_key` is `Actor.usage_key` (`account:<id>` or `browser:<id>`)."""
    kind, _, identity = usage_key.partition(":")
    if kind == "account":
        return _hashed("acct", identity)
    if kind == "browser":
        return _hashed("brw", identity)
    raise ValueError("usage key must start with account: or browser:")


def _ip_key(ip: str) -> str:
    return _hashed("iphash", ip)


def _daily_limit_usd(usage_key: str) -> float:
    if usage_key.startswith("account:"):
        return settings.account_daily_usage_limit_usd
    return settings.daily_usage_limit_usd


class UsageLimiter:
    def _db(self) -> SupabaseClient:
        try:
            return SupabaseClient()
        except SupabaseConfigError as e:
            logger.error("Supabase is required for usage limiting", exc_info=e)
            raise HTTPException(status_code=503, detail="Usage limiter is unavailable.") from e

    async def _claim(self, actor_key: str, endpoint: str, daily_limit_micro_usd: int, burst_limit: int, *, daily_limit_usd: float) -> dict:
        try:
            result = await self._db().rpc(
                "claim_api_request_slot",
                {
                    "p_actor_key": actor_key,
                    "p_endpoint": endpoint,
                    "p_daily_limit_microusd": daily_limit_micro_usd,
                    "p_burst_limit": burst_limit,
                    "p_window_seconds": settings.burst_limit_window_seconds,
                },
                expect_single=True,
            )
        except SupabaseAPIError as e:
            message = str(e)
            if "DAILY_LIMIT_EXCEEDED" in message:
                raise HTTPException(
                    status_code=429,
                    detail=f"Daily usage limit of ${daily_limit_usd:.2f} reached.",
                ) from e
            if "BURST_LIMIT_EXCEEDED" in message:
                raise HTTPException(
                    status_code=429,
                    detail="Too many requests in a short time. Please wait a moment and try again.",
                ) from e
            logger.warning("Usage claim failed for actor_key=%r endpoint=%r", actor_key, endpoint, exc_info=e)
            raise HTTPException(status_code=503, detail="Usage limiter is unavailable.") from e
        return result if isinstance(result, dict) else {}

    async def claim_request(self, actor: "Actor", endpoint: str) -> dict:
        """Counts one request against the actor's own daily budget and burst limit.

        Anonymous browsers also count against a much higher per-IP ceiling, which only trips for scripted
        abuse; a department behind one IP stays well under it. Accounts never touch the IP ceiling.
        """
        daily_limit_usd = _daily_limit_usd(actor.usage_key)
        if not actor.is_account:
            # The IP key never has spend recorded against it, so only its burst limit can trip.
            await self._claim(
                _ip_key(actor.ip), endpoint, _usd_to_micro_usd(1_000_000), settings.ip_burst_limit_requests,
                daily_limit_usd=daily_limit_usd,
            )
        return await self._claim(
            _actor_key(actor.usage_key), endpoint, _usd_to_micro_usd(daily_limit_usd), settings.burst_limit_requests,
            daily_limit_usd=daily_limit_usd,
        )

    async def record_usage(
        self, usage_key: str, input_tokens: int, output_tokens: int, model: str,
        *, cache_creation_input_tokens: int = 0, cache_read_input_tokens: int = 0,
    ) -> dict:
        cost_micro_usd = self.cost_micro_usd(
            input_tokens, output_tokens, model,
            cache_creation_input_tokens=cache_creation_input_tokens,
            cache_read_input_tokens=cache_read_input_tokens,
        )
        return await self.record_fixed_cost(usage_key, cost_micro_usd, reason=f"llm:{model}")

    async def record_fixed_cost(self, usage_key: str, cost_micro_usd: int, *, reason: str = "provider") -> dict:
        if cost_micro_usd <= 0:
            return {}
        actor_key = _actor_key(usage_key)
        try:
            result = await self._db().rpc(
                "record_api_usage",
                {
                    "p_actor_key": actor_key,
                    "p_cost_microusd": max(cost_micro_usd, 0),
                },
                expect_single=True,
            )
        except SupabaseAPIError as e:
            logger.warning("Usage recording failed for actor_key=%r reason=%r", actor_key, reason, exc_info=e)
            raise HTTPException(status_code=503, detail="Usage recording failed.") from e
        return result if isinstance(result, dict) else {}

    async def ensure_can_spend(self, usage_key: str, estimated_cost_micro_usd: int, *, operation: str) -> None:
        if estimated_cost_micro_usd <= 0:
            return
        summary = await self.get_summary(usage_key)
        remaining_micro_usd = _usd_to_micro_usd(float(summary["remaining"]))
        if remaining_micro_usd < estimated_cost_micro_usd:
            raise HTTPException(
                status_code=429,
                detail=(
                    f"Daily budget is too low for {operation}. "
                    f"Remaining ${summary['remaining']:.4f}; estimated cost ${_micro_usd_to_usd(estimated_cost_micro_usd):.4f}."
                ),
            )

    async def get_summary(self, usage_key: str) -> dict[str, float | int]:
        actor_key = _actor_key(usage_key)
        daily_limit_usd = _daily_limit_usd(usage_key)
        daily_limit_micro_usd = _usd_to_micro_usd(daily_limit_usd)
        try:
            result = await self._db().rpc(
                "get_api_usage_summary",
                {
                    "p_actor_key": actor_key,
                    "p_daily_limit_microusd": daily_limit_micro_usd,
                },
                expect_single=True,
            )
        except SupabaseAPIError as e:
            logger.warning("Usage summary failed for actor_key=%r", actor_key, exc_info=e)
            raise HTTPException(status_code=503, detail="Usage summary is unavailable.") from e

        used_micro_usd = int(result.get("used_microusd", 0)) if isinstance(result, dict) else 0
        remaining_micro_usd = int(result.get("remaining_microusd", daily_limit_micro_usd)) if isinstance(result, dict) else daily_limit_micro_usd
        request_count = int(result.get("request_count", 0)) if isinstance(result, dict) else 0
        segments = max(0, min(SEGMENTS, round((remaining_micro_usd / max(1, daily_limit_micro_usd)) * SEGMENTS)))
        return {
            "used": round(_micro_usd_to_usd(used_micro_usd), 6),
            "remaining": round(_micro_usd_to_usd(remaining_micro_usd), 6),
            "segments": segments,
            "requestCount": request_count,
            "dailyLimit": daily_limit_usd,
        }

    @staticmethod
    def cost_micro_usd(
        input_tokens: int, output_tokens: int, model: str,
        *, cache_creation_input_tokens: int = 0, cache_read_input_tokens: int = 0,
    ) -> int:
        pricing = _MODEL_PRICING_USD_PER_MILLION.get(model, _DEFAULT_PRICING_USD_PER_MILLION)
        prompt_tokens = input_tokens + cache_creation_input_tokens + cache_read_input_tokens
        if model == "claude-haiku-5-5" and prompt_tokens > 100_000:
            pricing = {"input": 0.50, "output": 2.50}
        # All current call sites use ephemeral caching with the default 5-minute TTL.
        billable_input = input_tokens + 1.25 * cache_creation_input_tokens + 0.1 * cache_read_input_tokens
        cost_usd = (billable_input * pricing["input"] + output_tokens * pricing["output"]) / 1_000_000
        return _usd_to_micro_usd(cost_usd)

    @staticmethod
    def provider_cost_micro_usd(tokens: int, usd_per_million_tokens: float) -> int:
        return _usd_to_micro_usd((max(tokens, 0) * usd_per_million_tokens) / 1_000_000)


limiter = UsageLimiter()
