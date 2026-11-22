"""The assistant on the home feed. Nothing is stored: the browser sends the conversation with each message."""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from datetime import date, timedelta
from typing import Any, AsyncIterator, Literal, Optional, get_args

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

from ..config import settings
from ..actor import Actor, current_actor
from ..services.feed_sources.adapters import (
    ArxivSource,
    BioRxivSource,
    HuggingFaceSource,
    JournalSource,
    MedRxivSource,
    RepositorySource,
)
from ..services.feed_sources.base import SearchRequest, SourceError, fetch, parse_records
from ..services.feed_domains import Domain
from ..services.feed_sources.openalex import OpenAlexSource
from ..services.llm import LLMClient, run_feed_agent
from ..services.usage_limiter import limiter

router = APIRouter()
logger = logging.getLogger(__name__)
_llm = LLMClient(api_key=settings.anthropic_api_key, model=settings.llm_model)

MAX_FEED_PAPERS = 40
MAX_MARKED_PAPERS = 30
MAX_HISTORY = 16
class AllSourcesSearch(OpenAlexSource):
    """All of OpenAlex in the time window. OpenAlexSource's own name makes it the feed's exclusive
    'everything else' tab, which leaves out arXiv, Hugging Face and journals; this one keeps them."""

    name = "all"


SOURCES = {
    "all": AllSourcesSearch,
    "openalex": OpenAlexSource,
    "arxiv": ArxivSource,
    "huggingface": HuggingFaceSource,
    "biorxiv": BioRxivSource,
    "medrxiv": MedRxivSource,
    "journals": JournalSource,
    "repositories": RepositorySource,
}


class FeedChatPaper(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(max_length=200)
    title: str = Field(max_length=1_000)
    abstract: str = Field(default="", max_length=8_000)
    authors: list[str] = Field(default_factory=list, max_length=100)
    published: Optional[str] = Field(default=None, max_length=40)
    topics: list[str] = Field(default_factory=list, max_length=20)
    url: Optional[str] = Field(default=None, max_length=2_000)


class FeedChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=8_000)


class FeedChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    question: str = Field(min_length=1, max_length=2_000)
    interests: str = Field(default="", max_length=600)
    domain: str = Field(default="general", max_length=40)
    feedPapers: list[FeedChatPaper] = Field(default_factory=list, max_length=MAX_FEED_PAPERS)
    markedPapers: list[FeedChatPaper] = Field(default_factory=list, max_length=MAX_MARKED_PAPERS)
    mentionedPaperIds: list[str] = Field(default_factory=list, max_length=MAX_MARKED_PAPERS)
    history: list[FeedChatTurn] = Field(default_factory=list, max_length=40)


def _brief(paper: dict[str, Any], abstract_chars: int) -> dict[str, Any]:
    abstract = " ".join(str(paper.get("abstract") or "").split())
    return {
        "id": paper.get("id"),
        "title": paper.get("title"),
        "authors": (paper.get("authors") or [])[:4],
        "published": paper.get("published"),
        "topics": (paper.get("topics") or [])[:3],
        "url": paper.get("url"),
        "abstract": abstract if len(abstract) <= abstract_chars else abstract[: abstract_chars - 1].rstrip() + "…",
    }


def _quotes(quote: object, question: str) -> bool:
    text = " ".join(str(quote or "").split()).lower()
    return len(text) >= 3 and text in " ".join(question.split()).lower()


async def _run(req: FeedChatRequest, actor: Actor, emit) -> None:
    await limiter.claim_request(actor, "chat_feed")
    budget = round(settings.agent_turn_budget_usd * 1_000_000)
    remaining: int | None = None
    with contextlib.suppress(Exception):
        summary = await limiter.get_summary(actor.usage_key)
        remaining = round(float(summary["remaining"]) * 1_000_000)
    if remaining is not None:
        if remaining <= 0:
            raise HTTPException(status_code=429, detail="Today's usage limit is used up. It resets tomorrow.")
        budget = min(budget, remaining)

    # Every paper the agent may refer to by id: the feed, the marked papers, and what it finds this turn.
    known: dict[str, dict[str, Any]] = {}
    for paper in [*req.feedPapers, *req.markedPapers]:
        known[paper.id] = paper.model_dump()
    marked_ids = {paper.id for paper in req.markedPapers}

    async def remember(papers: list) -> list[dict[str, Any]]:
        found = []
        for paper in papers:
            data = paper.model_dump()
            known[data["id"]] = data
            found.append(_brief(data, 400))
        return found

    async def tool(name: str, tool_input: dict[str, Any]) -> dict[str, Any]:
        await emit("tool_started", {"name": name})
        try:
            if name == "search_openalex_papers":
                query = str(tool_input.get("query") or "").strip()[:300]
                limit = min(max(int(tool_input.get("limit") or 6), 1), 10)
                params = {"search": query, "per_page": limit, "filter": "is_retracted:false,is_paratext:false"}
                if settings.openalex_api_key:
                    params["api_key"] = settings.openalex_api_key
                data = await fetch("https://api.openalex.org/works", params)
                papers = parse_records((data or {}).get("results"), OpenAlexSource.parse) if isinstance(data, dict) else []
                result = {"status": "completed", "papers": await remember(papers)}
            elif name == "search_recent_papers":
                query = str(tool_input.get("query") or "").strip()[:300]
                source = str(tool_input.get("source") or "all")
                days = min(max(int(tool_input.get("days") or 120), 7), 730)
                limit = min(max(int(tool_input.get("limit") or 6), 1), 10)
                today = date.today()
                provider = SOURCES.get(source, AllSourcesSearch)()
                domain = req.domain if req.domain in get_args(Domain) else "general"
                page = await provider.search(SearchRequest(
                    query=query, since=today - timedelta(days=days), until=today, limit=limit, domain=domain,
                ))
                result = {"status": "completed", "papers": await remember(page.papers)}
            elif name == "mark_papers":
                ids = [str(item) for item in (tool_input.get("paperIds") or [])][:20]
                papers = [known[paper_id] for paper_id in ids if paper_id in known and paper_id not in marked_ids]
                missing = [paper_id for paper_id in ids if paper_id not in known]
                if papers:
                    marked_ids.update(paper["id"] for paper in papers)
                    await emit("mark_papers", {"papers": papers})
                result = {"status": "completed", "marked": [paper["title"] for paper in papers], "unknownIds": missing}
            elif name == "update_interests":
                interests = " ".join(str(tool_input.get("interests") or "").split())[:600]
                if not _quotes(tool_input.get("researcherRequest"), req.question):
                    result = {"status": "skipped", "reason": "Only change interests when this message asks; quote it in researcherRequest."}
                elif not interests:
                    result = {"status": "skipped", "reason": "No interests given."}
                else:
                    await emit("interests_change", {"interests": interests})
                    result = {"status": "completed", "interests": interests}
            elif name == "show_papers":
                ids = [str(item) for item in (tool_input.get("paperIds") or [])][:10]
                papers = [known[paper_id] for paper_id in ids if paper_id in known]
                if papers:
                    await emit("papers_shown", {"papers": papers})
                result = {"status": "completed", "shown": [paper["title"] for paper in papers], "unknownIds": [i for i in ids if i not in known]}
            elif name == "offer_workspace":
                ids = [str(item) for item in (tool_input.get("paperIds") or [])][:30]
                papers = [known[paper_id] for paper_id in ids if paper_id in known] if ids else [known[i] for i in marked_ids if i in known]
                if not papers:
                    result = {"status": "skipped", "reason": "No papers to start from: give paperIds from your results, or ask them to mark papers."}
                else:
                    await emit("workspace_offer", {"papers": papers})
                    result = {"status": "completed", "paperCount": len(papers)}
            else:
                result = {"status": "error", "message": "Unknown tool."}
        except SourceError as exc:
            logger.warning("Feed agent search failed", exc_info=exc)
            result = {"status": "error", "message": "The search service is unavailable right now."}
        await emit("tool_completed", {"name": name, "status": result.get("status")})
        return result

    mentioned = [known[paper_id] for paper_id in req.mentionedPaperIds if paper_id in known]
    prompt = f"""Feed interests: {req.interests or "None set"}

Papers in the feed right now:
{json.dumps([_brief(p.model_dump(), 300) for p in req.feedPapers], ensure_ascii=False, indent=1) if req.feedPapers else "None"}

Marked papers:
{json.dumps([_brief(p.model_dump(), 2_000) for p in req.markedPapers], ensure_ascii=False, indent=1) if req.markedPapers else "None"}

Tagged with @ in this message:
{json.dumps([p["title"] for p in mentioned], ensure_ascii=False) if mentioned else "None"}

Message:
{req.question.strip()}"""

    result = await run_feed_agent(
        _llm,
        prompt,
        history=[turn.model_dump() for turn in req.history[-MAX_HISTORY:]],
        tool_runner=tool,
        text_emitter=lambda text: emit("text_delta", {"text": text}),
        ip=actor.usage_key,
        budget_micro_usd=budget,
        max_iterations=settings.agent_max_iterations,
    )
    await emit("message_completed", {"response": result})


@router.post("/feed-chat/stream")
async def feed_chat_stream(req: FeedChatRequest, actor: Actor = Depends(current_actor)):
    if not req.question.strip():
        raise HTTPException(status_code=400, detail="question required")
    queue: asyncio.Queue[tuple[str, dict[str, Any]] | None] = asyncio.Queue(maxsize=64)

    async def emit(event_type: str, payload: dict[str, Any]) -> None:
        await queue.put((event_type, payload))

    async def run() -> None:
        try:
            await _run(req, actor, emit)
        except HTTPException as exc:
            await emit("error", {"detail": exc.detail, "statusCode": exc.status_code})
        except Exception:
            logger.exception("Feed chat failed")
            await emit("error", {"detail": "Chat failed.", "statusCode": 500})
        finally:
            await queue.put(None)

    async def stream() -> AsyncIterator[str]:
        task = asyncio.create_task(run())
        try:
            while True:
                item = await queue.get()
                if item is None:
                    break
                yield f"event: {item[0]}\ndata: {json.dumps(item[1], ensure_ascii=False)}\n\n"
        finally:
            if not task.done():
                task.cancel()
                # Drop undelivered events so a producer blocked on a full queue can finish.
                while not queue.empty():
                    queue.get_nowait()
                with contextlib.suppress(asyncio.CancelledError):
                    await task

    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})
