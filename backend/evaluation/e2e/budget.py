"""Local estimated-spend ledger. Reservations survive failures and process exits."""
import json
import math
from pathlib import Path

PRICING_VERSION = "2026-10-08-standard"


class BudgetExceeded(RuntimeError):
    pass


def cost(provider, model, usage):
    """USD at published standard rates, including cache and long-context tiers."""
    if provider == "anthropic" and model == "claude-haiku-5-5":
        fresh = usage.get("input_tokens", 0)
        write = usage.get("cache_creation_input_tokens", 0) or 0
        read = usage.get("cache_read_input_tokens", 0) or 0
        total = fresh + write + read
        rate, output_rate = (0.5, 2.5) if total > 100_000 else (0.1, 0.5)
        return ((fresh + 1.25 * write + 0.1 * read) * rate + usage.get("output_tokens", 0) * output_rate) / 1e6
    if provider == "openai" and model == "gpt-6-astra":
        total = usage.get("prompt_tokens", 0)
        cached = (usage.get("prompt_tokens_details") or {}).get("cached_tokens", 0) or 0
        rate, output_rate = (20, 75) if total > 272_000 else (10, 50)
        return ((total - cached) * rate + cached * rate * 0.1 + usage.get("completion_tokens", 0) * output_rate) / 1e6
    raise ValueError(f"No verified eval pricing for {provider}/{model}")


def reserve_cost(provider, request):
    # Conservative text-only estimate: one token per serialized UTF-8 byte plus
    # framing/schema overhead. NOT a provider-enforced account spending limit.
    tokens = len(json.dumps(request, ensure_ascii=False).encode("utf-8")) + 4096
    maximum = request.get("max_completion_tokens", request.get("max_tokens"))
    if not isinstance(maximum, int) or maximum <= 0:
        raise ValueError("Every evaluated request must have an output-token cap")
    if provider == "anthropic":
        usage = {"cache_creation_input_tokens": tokens, "output_tokens": maximum}
    else:
        usage = {"prompt_tokens": tokens, "completion_tokens": maximum}
    return cost(provider, request["model"], usage)


class Budget:
    def __init__(self, limits, path=None):
        if any(not math.isfinite(v) or v < 0 for v in limits.values()):
            raise ValueError("Budgets must be finite nonnegative USD amounts")
        self.limits = limits
        self.path = Path(path) if path else None
        self.entries = []
        if self.path and self.path.exists():
            data = json.loads(self.path.read_text())
            if data["limits"] != limits or data["pricing_version"] != PRICING_VERSION:
                raise ValueError("Cannot resume with changed budgets or pricing")
            self.entries = data["entries"]
        self.blocked = any(e.get("estimate_exceeded") for e in self.entries)

    def summary(self):
        return {provider: {
            "limit_usd": limit,
            "recorded_usd": sum(e.get("actual_usd", 0) for e in self.entries if e["provider"] == provider),
            "reserved_unknown_usd": sum(e["reserved_usd"] for e in self.entries
                if e["provider"] == provider and "actual_usd" not in e),
        } for provider, limit in self.limits.items()}

    def save(self):
        if self.path:
            temporary = self.path.with_suffix(".tmp")
            temporary.write_text(json.dumps({"pricing_version": PRICING_VERSION,
                "limits": self.limits, "entries": self.entries}, indent=2))
            temporary.replace(self.path)

    async def call(self, provider, request, invoke):
        amount = reserve_cost(provider, request)
        summary = self.summary()[provider]
        if self.blocked or summary["recorded_usd"] + summary["reserved_unknown_usd"] + amount > self.limits[provider]:
            self.blocked = True
            raise BudgetExceeded(f"{provider} budget cannot reserve ${amount:.4f} for next call")
        entry = {"provider": provider, "model": request["model"], "reserved_usd": amount}
        self.entries.append(entry)
        self.save()  # Persist before sending; uncertain requests remain reserved.
        response = await invoke()
        usage = getattr(response, "usage", None)
        if usage is not None:
            usage = usage.model_dump() if hasattr(usage, "model_dump") else vars(usage)
            actual = cost(provider, request["model"], usage)
            entry.update(actual_usd=actual, usage=usage)
            if actual > amount:
                self.blocked = True
                entry["estimate_exceeded"] = True
            self.save()
        return response
