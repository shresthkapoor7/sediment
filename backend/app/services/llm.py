import json
import logging
from anthropic import AsyncAnthropic

logger = logging.getLogger(__name__)


class LLMParseError(Exception):
    pass


class LLMClient:
    def __init__(self, api_key: str, model: str):
        self.client = AsyncAnthropic(api_key=api_key)
        self.model = model

    async def rank_references(self, concept: str, papers: list[dict], top_n: int = 8) -> list[dict]:
        """
        Given a concept and a list of candidate papers (references of a seed paper),
        ask Claude Haiku to pick the top_n most important ancestors and write one-line summaries.

        Returns list of dicts: {title, year, summary, s2Id, authors, arxivId}
        Raises LLMParseError if the model response cannot be parsed.
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
            model=self.model,
            max_tokens=1024,
            messages=[{"role": "user", "content": prompt}],
        )

        raw = resp.content[0].text.strip()
        # strip markdown fences if present
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]

        try:
            ranked = json.loads(raw.strip())
        except (json.JSONDecodeError, ValueError) as e:
            logger.error(f"Failed to parse LLM response: {e}\nRaw: {resp.content[0].text}")
            raise LLMParseError(f"Invalid JSON from model: {e}") from e

        if not isinstance(ranked, list):
            logger.error(f"LLM returned non-list: {resp.content[0].text}")
            raise LLMParseError(f"Expected list, got {type(ranked).__name__}")

        result = []
        for item in ranked:
            if not isinstance(item, dict):
                continue
            idx = item.get("index")
            if not isinstance(idx, int) or not (0 <= idx < len(candidates)):
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
