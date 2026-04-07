import json
import logging
import re
from typing import Optional

from anthropic import AsyncAnthropic

logger = logging.getLogger(__name__)


class LLMParseError(Exception):
    pass


class LLMClient:
    def __init__(self, api_key: str, model: str):
        self.client = AsyncAnthropic(api_key=api_key)
        self.model = model

    async def choose_seed(self, query: str, papers: list[dict]) -> dict:
        if not papers:
            return {"index": None, "confidence": "low", "reason": "No candidates"}

        candidates = [
            {
                "index": i,
                "title": p["title"],
                "year": p.get("year"),
                "citedByCount": p.get("citedByCount", 0),
                "referencedWorksCount": p.get("referencedWorksCount", 0),
                "primaryTopic": p.get("primaryTopic"),
            }
            for i, p in enumerate(papers)
        ]

        prompt = f"""A user searched for: "{query}"

Choose the single best seed paper from these OpenAlex candidates.
Prefer the paper most likely to represent the user's intended topic, not just the most famous paper.
Prefer a work with a usable scholarly reference graph over a result with no real references.

Candidates:
{json.dumps(candidates, indent=2)}

Respond with JSON only:
{{
  "index": <candidate index or null>,
  "confidence": "high" | "medium" | "low",
  "reason": "<short reason>"
}}"""

        parsed = await self._prompt_json(prompt)
        if not isinstance(parsed, dict):
            raise LLMParseError("Seed choice response was not an object")

        idx = parsed.get("index")
        confidence = parsed.get("confidence")
        if idx is not None and (not isinstance(idx, int) or not (0 <= idx < len(candidates))):
            idx = None
        if confidence not in {"high", "medium", "low"}:
            confidence = "low"

        return {
            "index": idx,
            "confidence": confidence,
            "reason": parsed.get("reason", ""),
        }

    async def rank_references(self, concept: str, seed_paper: dict, papers: list[dict], top_n: int = 8) -> list[dict]:
        if not papers:
            return []

        candidates = [
            {
                "index": i,
                "title": p["title"],
                "year": p.get("year"),
                "abstract": (p.get("abstract") or "")[:220],
                "citedByCount": p.get("citedByCount", 0),
                "primaryTopic": p.get("primaryTopic"),
                "openalexId": p.get("openalexId"),
                "authors": p.get("authors", []),
                "doi": p.get("doi"),
                "detail": p.get("detail", ""),
            }
            for i, p in enumerate(papers)
        ]

        prompt = f"""You are tracing the intellectual lineage of: "{concept}"

Seed paper:
{json.dumps({
    "title": seed_paper.get("title"),
    "year": seed_paper.get("year"),
    "primaryTopic": seed_paper.get("primaryTopic"),
}, indent=2)}

Here are candidate ancestor papers. Pick the {top_n} most important ones for understanding how this seed paper came to exist.
Prefer foundational papers over incremental papers. Prefer papers with direct conceptual influence.

Candidates:
{json.dumps(candidates, indent=2)}

Respond with a JSON array only, ordered oldest to newest:
[
  {{
    "index": <original index>,
    "summary": "<one sentence on why this paper matters to the lineage>"
  }}
]"""

        parsed = await self._prompt_json(prompt)
        if not isinstance(parsed, list):
            raise LLMParseError("Lineage ranking response was not a list")

        results = []
        for item in parsed:
            if not isinstance(item, dict):
                continue
            idx = item.get("index")
            if not isinstance(idx, int) or not (0 <= idx < len(candidates)):
                continue
            candidate = candidates[idx]
            results.append({
                "openalexId": candidate["openalexId"],
                "title": candidate["title"],
                "year": candidate["year"],
                "summary": item.get("summary", ""),
                "detail": candidate.get("detail", ""),
                "authors": candidate["authors"],
                "doi": candidate["doi"],
            })
        return results

    async def chat_about_paper(self, paper: dict, question: str) -> dict:
        explicit_topic = _extract_explicit_topic(question)

        prompt = f"""You are helping a user understand a research paper in a lineage explorer.

Paper:
{json.dumps({
    "title": paper.get("title"),
    "year": paper.get("year"),
    "summary": paper.get("summary"),
    "authors": paper.get("authors", []),
}, indent=2)}

User question:
{question}

Important:
- If the user explicitly asks about a concept like "what is X" or "explain X", prefer that exact concept for any follow-up lineage suggestion.
- Do not default the suggestion to the current paper family unless that is clearly what the user asked for.

Respond with JSON only:
{{
  "text": "<helpful short answer, 2-5 sentences>",
  "suggestion": {{
    "topic": "<optional follow-up lineage topic>",
    "query": "<optional search query for that topic>",
    "nodeCount": <small integer>
  }} | null
}}

Only include a suggestion when there is a clear worthwhile follow-up lineage to trace."""

        parsed = await self._prompt_json(prompt)
        if not isinstance(parsed, dict):
            raise LLMParseError("Chat response was not an object")

        suggestion = parsed.get("suggestion")
        if suggestion is not None and not isinstance(suggestion, dict):
            suggestion = None

        cleaned_suggestion = None
        if isinstance(suggestion, dict):
            topic = suggestion.get("topic")
            query = suggestion.get("query")
            node_count = suggestion.get("nodeCount", 4)
            if isinstance(topic, str) and isinstance(query, str):
                cleaned_suggestion = {
                    "topic": topic,
                    "query": query,
                    "nodeCount": node_count if isinstance(node_count, int) else 4,
                }

        if explicit_topic:
            cleaned_suggestion = {
                "topic": explicit_topic,
                "query": explicit_topic,
                "nodeCount": 4,
            }

        text = parsed.get("text")
        return {
            "text": text if isinstance(text, str) else "I could not produce a useful answer for that question.",
            "suggestion": cleaned_suggestion,
        }

    async def _prompt_json(self, prompt: str):
        resp = await self.client.messages.create(
            model=self.model,
            max_tokens=1024,
            messages=[{"role": "user", "content": prompt}],
        )

        raw = resp.content[0].text.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]

        try:
            return json.loads(raw.strip())
        except (json.JSONDecodeError, ValueError) as e:
            logger.error("Failed to parse LLM response: %s\nRaw: %s", e, resp.content[0].text)
            raise LLMParseError(f"Invalid JSON from model: {e}") from e


def _extract_explicit_topic(question: str) -> Optional[str]:
    q = question.strip().rstrip("?").strip()
    patterns = [
        r"^what is (?:a |an |the )?(?P<topic>.+)$",
        r"^what are (?P<topic>.+)$",
        r"^explain (?:a |an |the )?(?P<topic>.+)$",
        r"^tell me about (?:a |an |the )?(?P<topic>.+)$",
        r"^trace (?:the )?lineage of (?:a |an |the )?(?P<topic>.+)$",
    ]

    for pattern in patterns:
        match = re.match(pattern, q, flags=re.IGNORECASE)
        if match:
            topic = match.group("topic").strip()
            if topic:
                return topic
    return None
