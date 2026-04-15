import asyncio
import logging
from datetime import date

from fastapi import HTTPException

logger = logging.getLogger(__name__)

HARD_LIMIT_USD = 0.15

# Pricing per million tokens (USD)
_MODEL_PRICING: dict[str, dict[str, float]] = {
    "claude-haiku-4-5-20251001": {"input": 1.00, "output": 5.00},
    "claude-3-5-haiku-20241022": {"input": 0.80, "output": 4.00},
    "claude-sonnet-4-6": {"input": 3.00, "output": 15.00},
    "claude-opus-4-6": {"input": 15.00, "output": 75.00},
}
_DEFAULT_PRICING: dict[str, float] = {"input": 3.00, "output": 15.00}


def _cost_usd(input_tokens: int, output_tokens: int, model: str) -> float:
    pricing = _MODEL_PRICING.get(model, _DEFAULT_PRICING)
    return (input_tokens * pricing["input"] + output_tokens * pricing["output"]) / 1_000_000


class UsageLimiter:
    def __init__(self, limit_usd: float = HARD_LIMIT_USD):
        self._limit = limit_usd
        self._usage: dict[str, float] = {}
        self._day: date = date.today()
        self._lock = asyncio.Lock()

    def _roll_day_if_needed(self) -> None:
        """Clear usage if the calendar day has changed. Must be called under self._lock."""
        today = date.today()
        if today != self._day:
            self._usage = {}
            self._day = today
            logger.info("Daily usage reset (new day: %s)", today)

    async def check_limit(self, ip: str) -> None:
        """Raise HTTP 429 if this IP has already hit or exceeded the limit."""
        async with self._lock:
            self._roll_day_if_needed()
            if self._usage.get(ip, 0.0) >= self._limit:
                raise HTTPException(
                    status_code=429,
                    detail=f"Usage limit of ${self._limit:.2f} per day reached. Resets at midnight.",
                )

    async def record(self, ip: str, input_tokens: int, output_tokens: int, model: str) -> None:
        """Add the cost of a completed API call to this IP's running total."""
        cost = _cost_usd(input_tokens, output_tokens, model)
        async with self._lock:
            self._roll_day_if_needed()
            self._usage[ip] = self._usage.get(ip, 0.0) + cost
        logger.debug("IP %s usage now $%.6f (+$%.6f)", ip, self._usage[ip], cost)

    def get(self, ip: str) -> float:
        """Return current usage for an IP (non-locking read, for the /usage endpoint)."""
        if date.today() != self._day:
            return 0.0
        return self._usage.get(ip, 0.0)


# Singleton — imported by llm.py
limiter = UsageLimiter()
