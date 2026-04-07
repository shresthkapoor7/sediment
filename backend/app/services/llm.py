import json
import logging
from anthropic import AsyncAnthropic

logger = logging.getLogger(__name__)

MODEL = "claude-haiku-4-5-20251001"


class LLMClient:
    def __init__(self, api_key: str):
        self.client = AsyncAnthropic(api_key=api_key)

    async def rank_references(self, concept: str, papers: list[dict], top_n: int = 8) -> list[dict]:
        """
        Given a concept and a list of candidate papers (references of a seed paper),
        ask Claude Haiku to pick the top_n most important ancestors and write one-line summaries.

        Returns list of dicts: {title, year, summary, s2Id, authors, arxivId}
        """
        if not papers:
            return []

        # Trim abstracts to save tokens
        candidates = [
            {
                "index": i,
                "title": p["title"],
                "year": p.get("year"),
                "abstract": (p.get("abstract") or "")[:200],
                "citationCount": p.get("citationCount", 0),
                "s2Id": p.get("s2Id"),
                "authors": p.get("authors", []),
                "arxivId": p.get("arxivId"),
            }
            for i, p in enumerate(papers)
        ]

        prompt = f"""You are tracing the intellectual lineage of: "{concept}"

Here are candidate ancestor papers. Pick the {top_n} most important ones for understanding how "{concept}" came to exist. Prefer papers that introduced foundational ideas, not incremental work.

Candidates:
{json.dumps(candidates, indent=2)}

Respond with a JSON array (no markdown, no explanation) of the top {top_n} papers, ordered oldest to newest:
[
  {{
    "index": <original index from candidates>,
    "summary": "<one sentence: what this paper contributed to {concept}>"
  }},
  ...
]"""

        resp = await self.client.messages.create(
            model=MODEL,
            max_tokens=1024,
            messages=[{"role": "user", "content": prompt}],
        )

        try:
            raw = resp.content[0].text.strip()
            # strip markdown fences if present
            if raw.startswith("```"):
                raw = raw.split("```")[1]
                if raw.startswith("json"):
                    raw = raw[4:]
            ranked = json.loads(raw.strip())
            result = []
            for item in ranked:
                idx = item.get("index")
                if idx is None or idx >= len(candidates):
                    continue
                c = candidates[idx]
                result.append({
                    "s2Id": c["s2Id"],
                    "title": c["title"],
                    "year": c["year"],
                    "summary": item.get("summary", ""),
                    "authors": c["authors"],
                    "arxivId": c["arxivId"],
                })
            return result
        except Exception as e:
            logger.error(f"Failed to parse LLM ranking: {e}\nRaw: {resp.content[0].text}")
            return []
