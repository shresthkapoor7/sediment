from __future__ import annotations

import asyncio
from dataclasses import dataclass
import math
import logging

import aiohttp

from ..config import settings
from .usage_limiter import limiter

logger = logging.getLogger(__name__)


class VoyageError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class RerankResult:
    index: int
    relevance_score: float


VOYAGE_EMBEDDING_PRICE_USD_PER_MILLION = {
    "voyage-4-large": 0.12,
    "voyage-4": 0.06,
    "voyage-4-lite": 0.02,
    "voyage-context-3": 0.18,
    "voyage-code-3": 0.18,
}
VOYAGE_RERANK_PRICE_USD_PER_MILLION = {
    "rerank-2.5": 0.05,
    "rerank-2.5-lite": 0.02,
    "rerank-2": 0.05,
    "rerank-2-lite": 0.02,
}
DEFAULT_EMBEDDING_PRICE_USD_PER_MILLION = 0.06
DEFAULT_RERANK_PRICE_USD_PER_MILLION = 0.02


def _api_key() -> str:
    api_key = settings.voyage_api_key.get_secret_value()
    if not api_key:
        raise VoyageError("voyage_not_configured", "Voyage is not configured.")
    return api_key


def estimate_tokens(text: str) -> int:
    return max(1, math.ceil(len(text) / 4))


def estimate_texts_tokens(texts: list[str]) -> int:
    return sum(estimate_tokens(text) for text in texts)


def embedding_cost_micro_usd(texts: list[str], model: str | None = None) -> int:
    price = VOYAGE_EMBEDDING_PRICE_USD_PER_MILLION.get(
        model or settings.embedding_model,
        DEFAULT_EMBEDDING_PRICE_USD_PER_MILLION,
    )
    return limiter.provider_cost_micro_usd(estimate_texts_tokens(texts), price)


def rerank_cost_micro_usd(query: str, documents: list[str], model: str | None = None) -> int:
    price = VOYAGE_RERANK_PRICE_USD_PER_MILLION.get(
        model or settings.rerank_model,
        DEFAULT_RERANK_PRICE_USD_PER_MILLION,
    )
    # Voyage bills rerank as (query tokens × document count) + document tokens.
    tokens = estimate_tokens(query) * len(documents) + estimate_texts_tokens(documents)
    return limiter.provider_cost_micro_usd(tokens, price)


async def embed_texts(texts: list[str], *, input_type: str, billing_ip: str | None = None) -> list[list[float]]:
    if not texts:
        return []
    cost_micro_usd = embedding_cost_micro_usd(texts)
    if billing_ip:
        await limiter.ensure_can_spend(billing_ip, cost_micro_usd, operation="Voyage embeddings")
    timeout = aiohttp.ClientTimeout(total=60, connect=8, sock_read=30)
    try:
        async with aiohttp.ClientSession(
            timeout=timeout,
            headers={"Authorization": f"Bearer {_api_key()}", "Content-Type": "application/json"},
        ) as session:
            async with session.post(
                "https://api.voyageai.com/v1/embeddings",
                json={
                    "input": texts,
                    "model": settings.embedding_model,
                    "input_type": input_type,
                    "output_dimension": settings.embedding_dimensions,
                    "truncation": False,
                },
            ) as response:
                if response.status != 200:
                    logger.warning("Voyage embedding rejected request status=%s", response.status)
                    if response.status in {401, 403}:
                        code = "embedding_auth_failed"
                    elif response.status == 429:
                        code = "embedding_rate_limited"
                    elif response.status == 402:
                        code = "embedding_billing_required"
                    else:
                        code = "embedding_rejected"
                    raise VoyageError(code, "Embedding provider rejected the request.")
                payload = await response.json()
    except (aiohttp.ClientError, asyncio.TimeoutError, ValueError) as exc:
        raise VoyageError("embedding_provider_unavailable", "Embedding provider failed.") from exc

    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, list) or len(data) != len(texts):
        raise VoyageError("embedding_invalid_response", "Embedding provider returned an invalid batch.")
    if any(not isinstance(item, dict) or not isinstance(item.get("index"), int) for item in data):
        raise VoyageError("embedding_invalid_response", "Embedding provider returned invalid indexes.")
    ordered = sorted(data, key=lambda item: item.get("index", 0))
    if [item["index"] for item in ordered] != list(range(len(texts))):
        raise VoyageError("embedding_invalid_response", "Embedding provider returned invalid indexes.")
    embeddings: list[list[float]] = []
    for item in ordered:
        embedding = item.get("embedding")
        if (
            not isinstance(embedding, list)
            or len(embedding) != settings.embedding_dimensions
            or any(not isinstance(value, (int, float)) for value in embedding)
        ):
            raise VoyageError("embedding_invalid_dimensions", "Embedding dimensions did not match configuration.")
        embeddings.append([float(value) for value in embedding])
    if billing_ip:
        try:
            await limiter.record_fixed_cost(billing_ip, cost_micro_usd, reason=f"voyage_embedding:{settings.embedding_model}")
        except Exception:
            logger.warning("Voyage embedding cost recording failed", exc_info=True)
    return embeddings


async def rerank(query: str, documents: list[str], *, top_k: int, billing_ip: str | None = None) -> list[RerankResult]:
    if not documents:
        return []
    cost_micro_usd = rerank_cost_micro_usd(query, documents)
    if billing_ip:
        await limiter.ensure_can_spend(billing_ip, cost_micro_usd, operation="Voyage rerank")
    timeout = aiohttp.ClientTimeout(total=45, connect=8, sock_read=25)
    try:
        async with aiohttp.ClientSession(
            timeout=timeout,
            headers={"Authorization": f"Bearer {_api_key()}", "Content-Type": "application/json"},
        ) as session:
            async with session.post(
                "https://api.voyageai.com/v1/rerank",
                json={
                    "query": query,
                    "documents": documents,
                    "model": settings.rerank_model,
                    "top_k": min(max(top_k, 1), len(documents)),
                    "return_documents": False,
                    "truncation": False,
                },
            ) as response:
                if response.status != 200:
                    logger.warning("Voyage rerank rejected request status=%s", response.status)
                    if response.status in {401, 403}:
                        code = "rerank_auth_failed"
                    elif response.status == 429:
                        code = "rerank_rate_limited"
                    elif response.status == 402:
                        code = "rerank_billing_required"
                    else:
                        code = "rerank_rejected"
                    raise VoyageError(code, "Reranking provider rejected the request.")
                payload = await response.json()
    except (aiohttp.ClientError, asyncio.TimeoutError, ValueError) as exc:
        raise VoyageError("rerank_provider_unavailable", "Reranking provider failed.") from exc

    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, list) or not data:
        raise VoyageError("rerank_invalid_response", "Reranking provider returned an invalid response.")
    results: list[RerankResult] = []
    seen: set[int] = set()
    for item in data:
        index = item.get("index") if isinstance(item, dict) else None
        score = item.get("relevance_score") if isinstance(item, dict) else None
        if not isinstance(index, int) or not 0 <= index < len(documents) or index in seen:
            raise VoyageError("rerank_invalid_response", "Reranking provider returned an invalid index.")
        if not isinstance(score, (int, float)):
            raise VoyageError("rerank_invalid_response", "Reranking provider returned an invalid score.")
        seen.add(index)
        results.append(RerankResult(index=index, relevance_score=float(score)))
    if billing_ip:
        try:
            await limiter.record_fixed_cost(billing_ip, cost_micro_usd, reason=f"voyage_rerank:{settings.rerank_model}")
        except Exception:
            logger.warning("Voyage rerank cost recording failed", exc_info=True)
    return results
