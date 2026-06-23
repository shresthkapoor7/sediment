from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path

from app.services.paper_retrieval import PaperRetrievalService


def _matches_expected(match: dict, case: dict) -> bool:
    content = match["content"].lower()
    section = match["citation"]["section"].lower()
    phrases = [str(value).lower() for value in case.get("expectedPhrases", [])]
    sections = [str(value).lower() for value in case.get("expectedSections", [])]
    return any(value in content for value in phrases) or any(value in section for value in sections)


def _rank(matches: list[dict], case: dict) -> int | None:
    return next(
        (index for index, match in enumerate(matches, start=1) if _matches_expected(match, case)),
        None,
    )


def _has_citation(match: dict) -> bool:
    citation = match.get("citation")
    return (
        isinstance(citation, dict)
        and bool(citation.get("id"))
        and bool(citation.get("openalexId"))
        and bool(citation.get("section"))
    )


def _summarize_ranks(ranks: list[int | None]) -> dict:
    count = len(ranks)
    hit_at_5 = sum(1 for rank in ranks if rank is not None and rank <= 5)
    hit_at_10 = sum(1 for rank in ranks if rank is not None and rank <= 10)
    reciprocal_rank = sum(1 / rank for rank in ranks if rank)
    return {
        "hitRateAt5": hit_at_5 / count if count else 0.0,
        "hitRateAt10": hit_at_10 / count if count else 0.0,
        "meanReciprocalRank": reciprocal_rank / count if count else 0.0,
    }


async def evaluate(cases: list[dict]) -> dict:
    service = PaperRetrievalService()
    reranked_ranks: list[int | None] = []
    vector_ranks: list[int | None] = []
    results: list[dict] = []
    citation_count = 0
    match_count = 0
    for case in cases:
        limit = max(10, int(case.get("limit", 10)))
        reranked = await service.search_paper(case["openalexId"], case["query"], limit=limit, use_rerank=True)
        vector = await service.search_paper(case["openalexId"], case["query"], limit=limit, use_rerank=False)
        reranked_rank = _rank(reranked["matches"], case)
        vector_rank = _rank(vector["matches"], case)
        reranked_ranks.append(reranked_rank)
        vector_ranks.append(vector_rank)
        citation_count += sum(1 for match in reranked["matches"] if _has_citation(match))
        match_count += len(reranked["matches"])
        results.append(
            {
                "openalexId": case["openalexId"],
                "query": case["query"],
                "rerankedRank": reranked_rank,
                "vectorOnlyRank": vector_rank,
                "rerankImproved": (
                    reranked_rank is not None
                    and (vector_rank is None or reranked_rank < vector_rank)
                ),
                "rerankRegressed": (
                    vector_rank is not None
                    and (reranked_rank is None or reranked_rank > vector_rank)
                ),
                "matchCount": len(reranked["matches"]),
                "topCitationsPresent": all(_has_citation(match) for match in reranked["matches"][:5]),
            }
        )

    count = len(cases)
    return {
        "caseCount": count,
        "reranked": _summarize_ranks(reranked_ranks),
        "vectorOnly": _summarize_ranks(vector_ranks),
        "rerankImprovementCount": sum(1 for item in results if item["rerankImproved"]),
        "rerankRegressionCount": sum(1 for item in results if item["rerankRegressed"]),
        "citationCoverage": citation_count / match_count if match_count else 0.0,
        "results": results,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate cached-paper retrieval and reranking.")
    parser.add_argument("cases", type=Path, help="JSON array of retrieval evaluation cases")
    args = parser.parse_args()
    cases = json.loads(args.cases.read_text())
    if not isinstance(cases, list):
        raise ValueError("Evaluation cases must be a JSON array.")
    print(json.dumps(asyncio.run(evaluate(cases)), indent=2))


if __name__ == "__main__":
    main()
