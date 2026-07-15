from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import re
from uuid import uuid4
from collections.abc import Awaitable, Callable, AsyncIterator
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import ValidationError

from ..config import settings
from ..db.supabase import SupabaseAPIError, SupabaseClient, SupabaseConfigError
from ..models import (
    MAX_TIMELINE_NOTE_CONNECTIONS,
    MAX_TIMELINE_NOTES,
    MAX_TIMELINE_PAPERS,
    ChatRequest,
    ChatResponse,
    ChatSessionRequest,
    ChatSessionResponse,
    GlobalChatRequest,
    GlobalChatResponse,
    PaperSummary,
)
from ..services.chat_memory import ChatContext, ChatMemoryService, serialize_chat_context
from ..services.llm import LLMClient, LLMParseError
from ..services.openalex import OpenAlexClient, OpenAlexError
from ..services.paper_access import PaperAccessChecker
from ..services.paper_ingestion import IngestionError, PaperIngestionService
from ..services.paper_retrieval import PaperRetrievalService, RetrievalError
from ..services.usage_limiter import limiter
from .search import get_request_ip

router = APIRouter()
logger = logging.getLogger(__name__)
CONFIRMATION_RE = re.compile(r"\b(yes|yeah|yep|sure|confirm|confirmed|go ahead|do it|access it|retrieve it)\b", re.I)
FULL_PAPER_RE = re.compile(r"\b(full|complete|entire)\s+(paper|text|article)|\b(access|retrieve|get|read|load|index)\s+(the\s+)?(full|complete|entire)?\s*(paper|text|article)\b", re.I)
ChatEventEmitter = Callable[[str, dict[str, Any]], Awaitable[None]]
NOTE_KINDS = {"field_note", "question", "insight", "todo", "contradiction"}
NOTE_COLORS = {"paper", "amber", "blue", "green", "rose"}
NOTE_RELATIONS = {"about", "question", "insight", "todo", "contradiction"}
NODE_BORDER_COLORS = {"accent", "blue", "green", "purple", "amber", "rose"}
NOTE_REFERENCE_RE = re.compile(r"\b(notes?|canvas)\b", re.I)
MUTATION_QUESTION_RE = re.compile(r"\?|^\s*(can|could|would|will|should|do|does|did|is|are|what|why|how|when|where|who)\b", re.I)
MUTATION_NEGATION_RE = re.compile(r"\b(do\s+not|don't|dont|never|avoid|without)\b", re.I)
NOTE_MUTATION_INTENT_RE = re.compile(
    r"^\s*(?:please\s+)?(?:add|create|write|make|edit|update|change|delete|remove|connect|disconnect|link|unlink)\b"
    r"|^\s*i\s+(?:want|need|would\s+like)\s+(?:you\s+)?to\s+(?:add|create|write|make|edit|update|change|delete|remove|connect|disconnect|link|unlink)\b",
    re.I,
)
NODE_COLOR_MUTATION_INTENT_RE = re.compile(
    r"^\s*(?:please\s+)?(?:color|colour|highlight|unhighlight|clear)\b"
    r"|^\s*i\s+(?:want|need|would\s+like)\s+(?:you\s+)?to\s+(?:color|colour|highlight|unhighlight|clear)\b",
    re.I,
)

_llm = LLMClient(api_key=settings.anthropic_api_key, model=settings.llm_model)


def _db() -> SupabaseClient:
    try:
        return SupabaseClient()
    except SupabaseConfigError as exc:
        raise HTTPException(status_code=503, detail="Chat persistence is not configured.") from exc


def _graph_papers(graph_data: object) -> list[dict]:
    if not isinstance(graph_data, dict) or not isinstance(graph_data.get("nodes"), dict):
        return []
    papers: list[dict] = []
    for node in graph_data["nodes"].values():
        paper = node.get("paper") if isinstance(node, dict) else None
        if isinstance(paper, dict) and isinstance(paper.get("openalexId"), str):
            papers.append(paper)
    return papers


def _graph_root_openalex_id(graph_data: object) -> str | None:
    if not isinstance(graph_data, dict) or not isinstance(graph_data.get("nodes"), dict):
        return None
    root_id = graph_data.get("rootId")
    node = graph_data["nodes"].get(str(root_id))
    if node is None:
        node = graph_data["nodes"].get(root_id)
    paper = node.get("paper") if isinstance(node, dict) else None
    return paper.get("openalexId") if isinstance(paper, dict) and isinstance(paper.get("openalexId"), str) else None


def _normalize_openalex_id(paper_id: object) -> str:
    if not isinstance(paper_id, str):
        return ""
    value = paper_id.strip()
    if "/" in value:
        value = value.rstrip("/").rsplit("/", 1)[-1]
    return value.upper()


def _unique_openalex_ids(value: object, limit: int) -> list[str]:
    if not isinstance(value, list):
        return []
    unique: list[str] = []
    seen: set[str] = set()
    for paper_id in value:
        normalized = _normalize_openalex_id(paper_id)
        if normalized and normalized not in seen:
            seen.add(normalized)
            unique.append(normalized)
        if len(unique) >= limit:
            break
    return unique


def _note_context_from_graph(graph_data: object) -> dict[str, list[dict[str, str]]]:
    if not isinstance(graph_data, dict):
        return {"notes": [], "connections": []}
    raw_notes = graph_data.get("notes")
    notes: list[dict[str, str]] = []
    if isinstance(raw_notes, dict):
        for note_id, raw_note in raw_notes.items():
            if not isinstance(raw_note, dict):
                continue
            resolved_id = str(raw_note.get("id") or note_id).strip()
            text = str(raw_note.get("text") or "").strip()
            kind = raw_note.get("kind") if raw_note.get("kind") in NOTE_KINDS else "field_note"
            color = raw_note.get("color") if raw_note.get("color") in NOTE_COLORS else "paper"
            if resolved_id and text:
                notes.append({"id": resolved_id, "text": text, "kind": kind, "color": color})

    raw_nodes = graph_data.get("nodes")
    raw_connections = graph_data.get("noteEdges")
    connections: list[dict[str, str]] = []
    if isinstance(raw_nodes, dict) and isinstance(raw_connections, list):
        for raw_connection in raw_connections:
            if not isinstance(raw_connection, dict):
                continue
            note_id = str(raw_connection.get("noteId") or "").strip()
            node = raw_nodes.get(str(raw_connection.get("nodeId")))
            if node is None:
                node = raw_nodes.get(raw_connection.get("nodeId"))
            paper = node.get("paper") if isinstance(node, dict) else None
            paper_id = paper.get("openalexId") if isinstance(paper, dict) else None
            relation = raw_connection.get("relation") if raw_connection.get("relation") in NOTE_RELATIONS else "about"
            if note_id and isinstance(paper_id, str) and paper_id.strip():
                connections.append({"noteId": note_id, "paperId": paper_id, "relation": relation})
    return {"notes": notes, "connections": connections}


def _node_color_context_from_graph(graph_data: object) -> list[dict[str, str]]:
    if not isinstance(graph_data, dict) or not isinstance(graph_data.get("nodes"), dict):
        return []
    colors: list[dict[str, str]] = []
    for node in graph_data["nodes"].values():
        if not isinstance(node, dict):
            continue
        paper = node.get("paper")
        annotation = node.get("annotation")
        paper_id = paper.get("openalexId") if isinstance(paper, dict) else None
        border_color = annotation.get("borderColor") if isinstance(annotation, dict) else None
        if isinstance(paper_id, str) and paper_id.strip() and border_color in NODE_BORDER_COLORS:
            colors.append({"paperId": paper_id, "borderColor": border_color})
            if len(colors) >= MAX_TIMELINE_PAPERS:
                break
    return colors


def _lineage_paper_payload(paper: dict[str, Any]) -> dict[str, Any]:
    detail = str(paper.get("detail") or paper.get("abstract") or "").strip()
    summary = detail.split(".", 1)[0].strip()
    if summary:
        summary = f"{summary}."
    else:
        summary = "OpenAlex metadata for this paper."
    return {
        "openalexId": paper.get("openalexId"),
        "title": paper.get("title") or "Untitled paper",
        "year": paper.get("year") if isinstance(paper.get("year"), int) else None,
        "summary": summary[:500],
        "detail": detail[:4_000],
        "authors": [author for author in paper.get("authors", []) if isinstance(author, str)][:20],
        "doi": paper.get("doi") if isinstance(paper.get("doi"), str) else None,
        "oaUrl": paper.get("oaUrl") if isinstance(paper.get("oaUrl"), str) else None,
        "isOa": bool(paper.get("isOa")),
        "oaStatus": paper.get("oaStatus") if isinstance(paper.get("oaStatus"), str) else None,
        "hasFulltext": bool(paper.get("hasFulltext")),
        "hasContentPdf": bool(paper.get("hasContentPdf")),
        "hasContentTei": bool(paper.get("hasContentTei")),
        "oaLicense": paper.get("oaLicense") if isinstance(paper.get("oaLicense"), str) else None,
        "concepts": [concept for concept in paper.get("concepts", []) if isinstance(concept, str)][:5],
        "type": paper.get("type") if isinstance(paper.get("type"), str) else None,
        "citedByCount": paper.get("citedByCount") if isinstance(paper.get("citedByCount"), int) else 0,
        "referencesCount": paper.get("referencedWorksCount") if isinstance(paper.get("referencedWorksCount"), int) else 0,
    }


def _lineage_search_candidate(paper: dict[str, Any]) -> dict[str, Any]:
    return {
        **_lineage_paper_payload(paper),
        "abstract": str(paper.get("abstract") or "")[:1_200],
        "referencedPaperIds": [
            paper_id
            for paper_id in paper.get("referencedWorks", [])
            if isinstance(paper_id, str)
        ][:30],
        "primaryTopic": paper.get("primaryTopic") if isinstance(paper.get("primaryTopic"), str) else None,
    }


def _latest_pending_action(context: ChatContext | None) -> dict[str, Any] | None:
    if not context:
        return None
    for message in reversed(context.messages):
        if message.get("role") != "assistant":
            continue
        tool_uses = message.get("tool_uses")
        if not isinstance(tool_uses, list):
            continue
        for tool in reversed(tool_uses):
            if not isinstance(tool, dict):
                continue
            result = tool.get("result")
            if (
                tool.get("name") == "retrieve_paper_content"
                and tool.get("status") == "needs_confirmation"
                and isinstance(result, dict)
            ):
                return {
                    "name": "retrieve_paper_content",
                    "message": result.get("message") or "Confirm to access the complete paper.",
                    "paperId": result.get("paperId"),
                }
    return None


def _has_recent_note_action(context: ChatContext | None) -> bool:
    if not context:
        return False
    for message in reversed(context.messages):
        if message.get("role") != "assistant":
            continue
        tool_uses = message.get("tool_uses")
        if not isinstance(tool_uses, list):
            continue
        for tool in reversed(tool_uses):
            if not isinstance(tool, dict) or tool.get("name") not in {"create_timeline_notes", "update_timeline_notes"}:
                continue
            result = tool.get("result")
            if not isinstance(result, dict):
                continue
            if any(result.get(key) for key in {"createdNotes", "updatedNotes", "deletedNoteIds", "connections", "disconnections"}):
                return True
        return False
    return False


def _allows_timeline_note_mutation(question: str, has_recent_note_action: bool) -> bool:
    """Require a current user request before model-selected note mutations."""
    return bool(
        _has_affirmative_mutation_intent(question, NOTE_MUTATION_INTENT_RE)
        and (NOTE_REFERENCE_RE.search(question) or has_recent_note_action)
    )


def _allows_timeline_node_color_mutation(question: str) -> bool:
    return _has_affirmative_mutation_intent(question, NODE_COLOR_MUTATION_INTENT_RE)


def _has_affirmative_mutation_intent(question: str, intent_re: re.Pattern[str]) -> bool:
    return bool(
        question.strip()
        and not MUTATION_QUESTION_RE.search(question)
        and not MUTATION_NEGATION_RE.search(question)
        and intent_re.search(question)
    )


def _allows_paper_retrieval(
    question: str,
    tool_input: dict[str, Any],
    pending_action: dict[str, Any] | None,
    requested_paper_id: str,
) -> bool:
    if pending_action and CONFIRMATION_RE.search(question):
        return _normalize_openalex_id(pending_action.get("paperId")) == _normalize_openalex_id(requested_paper_id)
    if bool(tool_input.get("confirmed")) and FULL_PAPER_RE.search(question):
        return True
    return False


def _tool_citations(result: dict[str, Any]) -> list[dict[str, Any]]:
    matches = result.get("matches")
    if not isinstance(matches, list):
        return []
    citations: list[dict[str, Any]] = []
    for match in matches:
        citation = match.get("citation") if isinstance(match, dict) else None
        if isinstance(citation, dict):
            citations.append(citation)
    return citations


async def _load_persistent_context(
    graph_id: str,
    user_id: str,
    scope: str,
    paper_openalex_id: str | None = None,
    message_limit: int = 24,
) -> tuple[SupabaseClient, dict, ChatMemoryService, ChatContext]:
    db = _db()
    graph = await db.get_graph(graph_id, user_id)
    if not graph:
        raise HTTPException(status_code=404, detail="Graph not found.")
    papers = _graph_papers(graph.get("data"))
    if scope == "paper" and not any(
        paper.get("openalexId") == paper_openalex_id for paper in papers
    ):
        raise HTTPException(status_code=404, detail="Paper is not present in this graph.")
    memory = ChatMemoryService(db)
    context = await memory.open(
        graph_id,
        user_id,
        scope,
        paper_openalex_id,
        message_limit=message_limit,
    )
    return db, graph, memory, context


def _compact_tool_result_for_event(result: dict[str, Any]) -> dict[str, Any]:
    compact = {
        key: value
        for key, value in result.items()
        if key not in {"matches", "papers", "addedPapers", "edges", "notes", "createdNotes", "updatedNotes", "connections", "disconnections", "nodeColorChanges", "nodeColors"}
    }
    matches = result.get("matches")
    if isinstance(matches, list):
        compact["matchCount"] = len(matches)
        compact["citations"] = _tool_citations(result)
    papers = result.get("papers")
    if isinstance(papers, list):
        compact["paperCount"] = len(papers)
    added_papers = result.get("addedPapers")
    if isinstance(added_papers, list):
        compact["addedPaperCount"] = len(added_papers)
    edges = result.get("edges")
    if isinstance(edges, list):
        compact["edgeCount"] = len(edges)
    notes = result.get("notes")
    if isinstance(notes, list):
        compact["noteCount"] = len(notes)
    created_notes = result.get("createdNotes")
    if isinstance(created_notes, list):
        compact["createdNoteCount"] = len(created_notes)
    updated_notes = result.get("updatedNotes")
    if isinstance(updated_notes, list):
        compact["updatedNoteCount"] = len(updated_notes)
    node_color_changes = result.get("nodeColorChanges")
    if isinstance(node_color_changes, list):
        compact["nodeColorCount"] = len(node_color_changes)
    node_colors = result.get("nodeColors")
    if isinstance(node_colors, list):
        compact["nodeColorCount"] = len(node_colors)
    return compact


async def _emit(event_emitter: ChatEventEmitter | None, event_type: str, payload: dict[str, Any]) -> None:
    if event_emitter:
        await event_emitter(event_type, payload)


async def _run_paper_chat(req: ChatRequest, request_ip: str, event_emitter: ChatEventEmitter | None = None) -> dict[str, Any]:
    await _emit(event_emitter, "message_started", {"paperId": req.paperId.upper()})
    await limiter.claim_request(request_ip, "chat")

    context = None
    memory = None
    persistent_paper = None
    if req.graphId and req.userId:
        await _emit(event_emitter, "status", {"message": "Restoring paper chat context"})
        try:
            _, graph, memory, context = await _load_persistent_context(
                req.graphId,
                req.userId,
                "paper",
                req.paperId.upper(),
            )
            persistent_paper = next(
                paper for paper in _graph_papers(graph.get("data"))
                if paper.get("openalexId") == req.paperId.upper()
            )
            await memory.append(
                context,
                req.userId,
                "user",
                req.question.strip(),
                tool_uses=(
                    [{"name": "paper_selected_excerpt", "excerpt": req.selectedExcerpt.strip()}]
                    if req.selectedExcerpt and req.selectedExcerpt.strip()
                    else None
                ),
            )
        except SupabaseAPIError as exc:
            logger.warning("Paper chat persistence failed for graph_id=%r", req.graphId, exc_info=exc)
            raise HTTPException(status_code=502, detail="Chat history could not be saved.") from exc

    paper = persistent_paper or {
        "openalexId": req.paperId,
        "title": req.title,
        "year": req.year,
        "summary": req.summary,
    }
    try:
        if context and memory and req.graphId and req.userId:
            pending_action = _latest_pending_action(context)
            if pending_action and not pending_action.get("paperId"):
                pending_action = {**pending_action, "paperId": req.paperId.upper()}
            retrieval = PaperRetrievalService(memory.db)

            async def run_paper_tool(name: str, tool_input: dict[str, Any]) -> dict[str, Any]:
                await _emit(event_emitter, "tool_started", {"name": name, "input": tool_input})
                await _emit(event_emitter, "status", {"message": _tool_status_message(name, "started")})
                if name == "check_paper_access":
                    result = await PaperAccessChecker().check(req.paperId.upper())
                    await _emit(event_emitter, "tool_completed", {
                        "name": name,
                        "status": result.get("accessStatus") or result.get("status") or "completed",
                        "result": _compact_tool_result_for_event(result),
                    })
                    return result

                if name == "retrieve_paper_content":
                    if not _allows_paper_retrieval(req.question, tool_input, pending_action, req.paperId):
                        result = {
                            "status": "needs_confirmation",
                            "requiresConfirmation": True,
                            "message": "Please confirm that you want me to access and index the complete paper.",
                            "paperId": req.paperId.upper(),
                        }
                        await _emit(event_emitter, "tool_completed", {
                            "name": name,
                            "status": result["status"],
                            "result": result,
                        })
                        return result
                    try:
                        result = await PaperIngestionService().ingest(req.paperId.upper(), paper, billing_ip=request_ip)
                    except IngestionError as exc:
                        result = {
                            "status": "unavailable" if exc.code in {"access_provider_failed", "no_extractable_text"} else "error",
                            "message": str(exc),
                            "errorCode": exc.code,
                        }
                    await _emit(event_emitter, "tool_completed", {
                        "name": name,
                        "status": result.get("status") or "completed",
                        "result": _compact_tool_result_for_event(result),
                    })
                    return result

                if name == "search_paper_content":
                    query = str(tool_input.get("query") or req.question).strip()[:1000]
                    try:
                        search_result = await retrieval.search_paper(req.paperId.upper(), query, limit=6, billing_ip=request_ip)
                        result = {
                            "status": "completed",
                            **search_result,
                            "citations": _tool_citations(search_result),
                        }
                    except RetrievalError as exc:
                        result = {"status": "error", "message": str(exc)}
                    await _emit(event_emitter, "tool_completed", {
                        "name": name,
                        "status": result.get("status") or "completed",
                        "result": _compact_tool_result_for_event(result),
                    })
                    if result.get("citations"):
                        await _emit(event_emitter, "citations", {"citations": result["citations"]})
                    return result

                result = {"status": "error", "message": "Unknown tool requested."}
                await _emit(event_emitter, "tool_completed", {"name": name, "status": "error", "result": result})
                return result

            await _emit(event_emitter, "status", {"message": "Thinking with paper tools"})
            result = await _llm.chat_about_paper_agentic(
                paper,
                req.question.strip(),
                tool_runner=run_paper_tool,
                text_emitter=(
                    (lambda text: _emit(event_emitter, "text_delta", {"text": text}))
                    if event_emitter
                    else None
                ),
                ip=request_ip,
                history=context.history,
                summary=context.summary,
                selected_excerpt=req.selectedExcerpt.strip() if req.selectedExcerpt else None,
                pending_action=pending_action,
            )
        else:
            await _emit(event_emitter, "status", {"message": "Thinking"})
            result = await _llm.chat_about_paper(
                paper,
                req.question.strip(),
                ip=request_ip,
                history=None,
                summary=None,
            )
    except LLMParseError as e:
        logger.warning("Paper chat failed for paper_id=%r", req.paperId, exc_info=e)
        raise HTTPException(status_code=502, detail="Chat service returned an invalid response.") from e
    except Exception as e:
        logger.warning("Paper chat upstream failed for paper_id=%r", req.paperId, exc_info=e)
        raise HTTPException(status_code=502, detail="Chat service is currently unavailable.") from e

    if result.get("text") and not result.get("textStreamed"):
        await _emit(event_emitter, "text_delta", {"text": result["text"]})
    if result.get("citations"):
        await _emit(event_emitter, "citations", {"citations": result["citations"]})

    if context and memory and req.userId:
        tool_uses = result.get("toolUses") or []
        try:
            assistant = await memory.append(
                context,
                req.userId,
                "assistant",
                result.get("text") or "",
                tool_uses=tool_uses,
                citations=result.get("citations") or [],
            )
            result["sessionId"] = context.session["id"]
            try:
                await memory.maybe_summarize(
                    context,
                    req.userId,
                    int(assistant["sequence_number"]),
                    _llm,
                    request_ip,
                )
            except SupabaseAPIError as exc:
                logger.warning("Paper chat summary update failed", exc_info=exc)
        except SupabaseAPIError as exc:
            logger.warning("Assistant message persistence failed", exc_info=exc)
            raise HTTPException(status_code=502, detail="Chat response could not be saved.") from exc

    await _emit(event_emitter, "message_completed", {"response": result})
    return result


def _tool_status_message(name: str, state: str) -> str:
    if name == "search_openalex_papers":
        return "Searching OpenAlex" if state == "started" else "OpenAlex search finished"
    if name == "update_lineage":
        return "Updating the lineage" if state == "started" else "Lineage updated"
    if name == "update_timeline_node_colors":
        return "Coloring timeline nodes" if state == "started" else "Timeline nodes colored"
    if name == "read_timeline_node_colors":
        return "Reading timeline node colors" if state == "started" else "Timeline node colors read"
    if name == "read_timeline_notes":
        return "Reading canvas notes" if state == "started" else "Canvas notes read"
    if name == "create_timeline_notes":
        return "Creating canvas notes" if state == "started" else "Canvas notes created"
    if name == "update_timeline_notes":
        return "Updating canvas notes" if state == "started" else "Canvas notes updated"
    if name == "check_paper_access":
        return "Checking paper access" if state == "started" else "Checked paper access"
    if name == "retrieve_paper_content":
        return "Accessing and indexing complete paper" if state == "started" else "Paper access finished"
    if name == "search_paper_content":
        return "Searching paper content" if state == "started" else "Paper search finished"
    if name == "web_search":
        return "Searching public sources"
    return "Running tool"


def _sse(event_type: str, payload: dict[str, Any]) -> str:
    return f"event: {event_type}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


async def _paper_chat_event_stream(req: ChatRequest, request_ip: str) -> AsyncIterator[str]:
    queue: asyncio.Queue[tuple[str, dict[str, Any]] | None] = asyncio.Queue(maxsize=64)

    async def emit(event_type: str, payload: dict[str, Any]) -> None:
        await queue.put((event_type, payload))

    async def run() -> None:
        try:
            await _run_paper_chat(req, request_ip, emit)
        except HTTPException as exc:
            await emit("error", {"detail": exc.detail, "statusCode": exc.status_code})
        except Exception:
            logger.exception("Streaming paper chat failed")
            await emit("error", {"detail": "Chat failed.", "statusCode": 500})
        finally:
            await queue.put(None)

    task = asyncio.create_task(run())
    try:
        while True:
            item = await queue.get()
            if item is None:
                break
            yield _sse(item[0], item[1])
    finally:
        if not task.done():
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task


def _paper_by_id(papers: list[dict], paper_id: str | None) -> dict | None:
    normalized = _normalize_openalex_id(paper_id)
    if not normalized:
        return None
    return next((paper for paper in papers if _normalize_openalex_id(paper.get("openalexId")) == normalized), None)


def _resolve_mentioned_paper_ids(
    paper_by_normalized_id: dict[str, dict],
    requested_paper_ids: list[str],
) -> list[str]:
    return list(dict.fromkeys(
        paper_by_normalized_id[normalized]["openalexId"]
        for paper_id in requested_paper_ids
        if (normalized := _normalize_openalex_id(paper_id)) in paper_by_normalized_id
    ))


async def _run_global_chat(req: GlobalChatRequest, request_ip: str, event_emitter: ChatEventEmitter | None = None) -> dict[str, Any]:
    await _emit(event_emitter, "message_started", {})
    await limiter.claim_request(request_ip, "chat_global")

    context = None
    memory = None
    graph_data: dict[str, Any] | None = None
    papers = [p.model_dump() for p in req.papers]
    paper_by_normalized_id = {
        _normalize_openalex_id(paper.get("openalexId")): paper
        for paper in papers
        if _normalize_openalex_id(paper.get("openalexId"))
    }
    mentioned_paper_ids = _resolve_mentioned_paper_ids(paper_by_normalized_id, req.mentionedPaperIds)
    if req.graphId and req.userId:
        await _emit(event_emitter, "status", {"message": "Restoring timeline chat context"})
        try:
            _, graph, memory, context = await _load_persistent_context(
                req.graphId,
                req.userId,
                "graph",
            )
            graph_data = graph.get("data") if isinstance(graph.get("data"), dict) else None
            papers = _graph_papers(graph_data)
            if not papers:
                raise HTTPException(status_code=400, detail="Graph contains no papers.")
            paper_by_normalized_id = {
                _normalize_openalex_id(paper.get("openalexId")): paper
                for paper in papers
                if _normalize_openalex_id(paper.get("openalexId"))
            }
            mentioned_paper_ids = _resolve_mentioned_paper_ids(paper_by_normalized_id, req.mentionedPaperIds)
            await memory.append(
                context,
                req.userId,
                "user",
                req.question.strip(),
                tool_uses=(
                    [{"name": "global_user_message", "mentionedPaperIds": mentioned_paper_ids}]
                    if mentioned_paper_ids
                    else None
                ),
            )
        except SupabaseAPIError as exc:
            logger.warning("Global chat persistence failed for graph_id=%r", req.graphId, exc_info=exc)
            raise HTTPException(status_code=502, detail="Chat history could not be saved.") from exc

    valid_ids = {paper.get("openalexId") for paper in papers}
    primary_paper_id = mentioned_paper_ids[0] if mentioned_paper_ids else None
    root_paper_id = _graph_root_openalex_id(graph_data)
    pending_action = _latest_pending_action(context)
    has_recent_note_action = _has_recent_note_action(context)
    if pending_action and not pending_action.get("paperId") and primary_paper_id:
        pending_action = {**pending_action, "paperId": primary_paper_id}
    retrieval = PaperRetrievalService(memory.db) if memory else None
    searched_openalex_papers: dict[str, dict[str, Any]] = {}
    lineage_edges: list[dict[str, str]] = []
    raw_note_context = req.noteContext.model_dump() if req.noteContext else _note_context_from_graph(graph_data)
    raw_node_color_context = (
        [item.model_dump() for item in req.nodeColorContext]
        if req.nodeColorContext is not None
        else _node_color_context_from_graph(graph_data)
    )
    notes_by_id = {
        note["id"]: dict(note)
        for note in raw_note_context["notes"][:MAX_TIMELINE_NOTES]
        if note.get("id") and note.get("text")
    }

    def resolve_current_paper_id(paper_id: object) -> str | None:
        normalized_id = _normalize_openalex_id(paper_id)
        if not normalized_id:
            return None
        for paper in papers:
            if _normalize_openalex_id(paper.get("openalexId")) == normalized_id:
                return str(paper.get("openalexId"))
        return None

    node_colors_by_normalized_paper_id: dict[str, str] = {}
    for raw_color in raw_node_color_context:
        if not isinstance(raw_color, dict):
            continue
        canonical_paper_id = resolve_current_paper_id(raw_color.get("paperId"))
        border_color = raw_color.get("borderColor")
        if canonical_paper_id and border_color in NODE_BORDER_COLORS:
            node_colors_by_normalized_paper_id[_normalize_openalex_id(canonical_paper_id)] = border_color

    note_connections: list[dict[str, str]] = []
    seen_note_connection_keys: set[tuple[str, str]] = set()
    for raw_connection in raw_note_context["connections"]:
        if not isinstance(raw_connection, dict):
            continue
        note_id = str(raw_connection.get("noteId") or "").strip()
        canonical_paper_id = resolve_current_paper_id(raw_connection.get("paperId"))
        relation = raw_connection.get("relation")
        if (
            note_id not in notes_by_id
            or not canonical_paper_id
            or relation not in NOTE_RELATIONS
        ):
            continue
        key = (note_id, _normalize_openalex_id(canonical_paper_id))
        if key in seen_note_connection_keys:
            continue
        if len(note_connections) >= MAX_TIMELINE_NOTE_CONNECTIONS:
            break
        seen_note_connection_keys.add(key)
        note_connections.append({
            "noteId": note_id,
            "paperId": canonical_paper_id,
            "relation": relation,
        })

    timeline_note_index = [
        {
            "id": note["id"],
            "kind": note["kind"],
            "color": note["color"],
            "connectedPaperIds": [
                connection["paperId"]
                for connection in note_connections
                if connection["noteId"] == note["id"]
            ],
        }
        for note in notes_by_id.values()
    ]

    def add_note_connection(note_id: str, paper_id: object, relation: object, skipped: list[dict[str, str]]) -> dict[str, str] | None:
        canonical_paper_id = resolve_current_paper_id(paper_id)
        if note_id not in notes_by_id:
            skipped.append({"noteId": note_id, "reason": "note_not_found"})
            return None
        if not canonical_paper_id:
            skipped.append({"noteId": note_id, "reason": "paper_not_in_timeline"})
            return None
        if relation not in NOTE_RELATIONS:
            skipped.append({"noteId": note_id, "reason": "invalid_note_relation"})
            return None
        connection = {"noteId": note_id, "paperId": canonical_paper_id, "relation": relation}
        if any(
            existing["noteId"] == note_id and _normalize_openalex_id(existing["paperId"]) == _normalize_openalex_id(canonical_paper_id)
            for existing in note_connections
        ):
            skipped.append({"noteId": note_id, "reason": "note_connection_duplicate"})
            return None
        if len(note_connections) >= MAX_TIMELINE_NOTE_CONNECTIONS:
            skipped.append({"noteId": note_id, "reason": "note_connection_limit_reached"})
            return None
        note_connections.append(connection)
        return connection

    async def run_global_tool(name: str, tool_input: dict[str, Any]) -> dict[str, Any]:
        await _emit(event_emitter, "tool_started", {"name": name, "input": tool_input})
        await _emit(event_emitter, "status", {"message": _tool_status_message(name, "started")})

        if name == "search_openalex_papers":
            query = str(tool_input.get("query") or "").strip()[:300]
            try:
                limit = max(1, min(int(tool_input.get("limit") or 5), 8))
            except (TypeError, ValueError):
                limit = 5
            if not query:
                result = {"status": "error", "message": "A search query is required."}
                await _emit(event_emitter, "tool_completed", {"name": name, "status": "error", "result": result})
                return result
            try:
                async with OpenAlexClient(
                    api_key=settings.openalex_api_key,
                    mailto=settings.openalex_mailto,
                ) as openalex:
                    matches = await openalex.search_papers(query, limit=limit)
            except OpenAlexError:
                result = {"status": "error", "message": "OpenAlex search is currently unavailable."}
                await _emit(event_emitter, "tool_completed", {"name": name, "status": "error", "result": result})
                return result

            candidates = []
            for paper in matches[:8]:
                normalized = _normalize_openalex_id(paper.get("openalexId"))
                if not normalized:
                    continue
                searched_openalex_papers[normalized] = paper
                candidates.append(_lineage_search_candidate(paper))
            result = {"status": "completed", "query": query, "papers": candidates}
            await _emit(event_emitter, "tool_completed", {
                "name": name,
                "status": result["status"],
                "result": _compact_tool_result_for_event(result),
            })
            return result

        if name == "update_lineage":
            asks_to_connect_a_note = bool(re.search(r"\bnote\b", req.question, re.I)) or (
                has_recent_note_action
                and bool(re.search(r"\b(connect|link)\s+(it|this|that)\b", req.question, re.I))
            )
            if asks_to_connect_a_note and not tool_input.get("addPaperIds") and not tool_input.get("removePaperIds"):
                result = {
                    "status": "error",
                    "message": "This request targets a canvas note. Use update_timeline_notes to connect the note to the paper.",
                }
                await _emit(event_emitter, "tool_completed", {"name": name, "status": "error", "result": result})
                return result
            if not req.graphId or not req.userId:
                result = {
                    "status": "error",
                    "message": "Lineage edits require a saved graph. Try again after the timeline has been saved.",
                }
                await _emit(event_emitter, "tool_completed", {"name": name, "status": "error", "result": result})
                return result

            requested_additions = _unique_openalex_ids(tool_input.get("addPaperIds"), 5)
            requested_removals = _unique_openalex_ids(tool_input.get("removePaperIds"), 10)
            current_by_normalized_id = {
                _normalize_openalex_id(paper.get("openalexId")): paper
                for paper in papers
                if _normalize_openalex_id(paper.get("openalexId"))
            }
            skipped: list[dict[str, str]] = []
            removed_paper_ids: list[str] = []
            for paper_id in requested_removals:
                paper = current_by_normalized_id.get(paper_id)
                if not paper:
                    skipped.append({"paperId": paper_id, "reason": "not_in_timeline"})
                    continue
                canonical_id = str(paper.get("openalexId"))
                if _normalize_openalex_id(canonical_id) == _normalize_openalex_id(root_paper_id):
                    skipped.append({"paperId": canonical_id, "reason": "seed_paper"})
                    continue
                removed_paper_ids.append(canonical_id)

            added_papers: list[dict[str, Any]] = []
            for paper_id in requested_additions:
                if paper_id in current_by_normalized_id:
                    skipped.append({"paperId": current_by_normalized_id[paper_id]["openalexId"], "reason": "already_in_timeline"})
                    continue
                paper = searched_openalex_papers.get(paper_id)
                if not paper:
                    skipped.append({"paperId": paper_id, "reason": "not_returned_by_openalex_search"})
                    continue
                added_papers.append(_lineage_paper_payload(paper))

            retained_ids = {
                _normalize_openalex_id(paper.get("openalexId"))
                for paper in papers
                if _normalize_openalex_id(paper.get("openalexId"))
                and paper.get("openalexId") not in removed_paper_ids
            }
            known_papers = {
                **{
                    _normalize_openalex_id(paper.get("openalexId")): str(paper.get("openalexId"))
                    for paper in papers
                    if _normalize_openalex_id(paper.get("openalexId"))
                },
                **{
                    _normalize_openalex_id(paper.get("openalexId")): str(paper.get("openalexId"))
                    for paper in added_papers
                    if _normalize_openalex_id(paper.get("openalexId"))
                },
            }
            retained_ids.update(_normalize_openalex_id(paper.get("openalexId")) for paper in added_papers)
            edges: list[dict[str, str]] = []
            edge_keys = {
                f"{edge['parentOpenalexId']}->{edge['childOpenalexId']}"
                for edge in lineage_edges
            }
            raw_edges = tool_input.get("edges") if isinstance(tool_input.get("edges"), list) else []
            for raw_edge in raw_edges[:12]:
                if not isinstance(raw_edge, dict):
                    skipped.append({"paperId": "<invalid edge>", "reason": "edge_invalid_payload"})
                    continue
                parent_normalized = _normalize_openalex_id(raw_edge.get("parentPaperId"))
                child_normalized = _normalize_openalex_id(raw_edge.get("childPaperId"))
                edge_id = f"{raw_edge.get('parentPaperId') or '?'}->{raw_edge.get('childPaperId') or '?'}"
                if (
                    not parent_normalized
                    or not child_normalized
                    or parent_normalized not in retained_ids
                    or child_normalized not in retained_ids
                ):
                    skipped.append({"paperId": edge_id, "reason": "edge_invalid_reference"})
                    continue
                if parent_normalized == child_normalized:
                    skipped.append({"paperId": edge_id, "reason": "edge_self_loop"})
                    continue
                relation = raw_edge.get("relation")
                if relation not in {"influenced", "inferred"}:
                    skipped.append({"paperId": edge_id, "reason": "edge_invalid_relation"})
                    continue
                edge = {
                    "parentOpenalexId": known_papers[parent_normalized],
                    "childOpenalexId": known_papers[child_normalized],
                    "relation": relation,
                }
                key = f"{edge['parentOpenalexId']}->{edge['childOpenalexId']}"
                if key in edge_keys:
                    skipped.append({"paperId": edge_id, "reason": "edge_duplicate"})
                    continue
                edge_keys.add(key)
                edges.append(edge)

            result = {
                "status": "completed",
                "addedPapers": added_papers,
                "removedPaperIds": list(dict.fromkeys(removed_paper_ids)),
                "edges": edges,
                "skipped": skipped,
            }
            removed_normalized_ids = {_normalize_openalex_id(paper_id) for paper_id in removed_paper_ids}
            papers[:] = [
                paper
                for paper in papers
                if _normalize_openalex_id(paper.get("openalexId")) not in removed_normalized_ids
            ]
            current_ids = {
                _normalize_openalex_id(paper.get("openalexId"))
                for paper in papers
                if _normalize_openalex_id(paper.get("openalexId"))
            }
            for paper in added_papers:
                normalized_id = _normalize_openalex_id(paper.get("openalexId"))
                if normalized_id and normalized_id not in current_ids:
                    papers.append(paper)
                    current_ids.add(normalized_id)
            valid_ids.clear()
            valid_ids.update(paper.get("openalexId") for paper in papers)
            lineage_edges[:] = [
                edge
                for edge in [*lineage_edges, *edges]
                if (
                    _normalize_openalex_id(edge["parentOpenalexId"]) not in removed_normalized_ids
                    and _normalize_openalex_id(edge["childOpenalexId"]) not in removed_normalized_ids
                )
            ]
            await _emit(event_emitter, "tool_completed", {
                "name": name,
                "status": result["status"],
                "result": _compact_tool_result_for_event(result),
            })
            return result

        if name == "read_timeline_node_colors":
            requested_paper_ids = {
                _normalize_openalex_id(paper_id)
                for paper_id in tool_input.get("paperIds", [])
                if isinstance(paper_id, str) and _normalize_openalex_id(paper_id)
            }
            requested_colors = {
                color
                for color in tool_input.get("colors", [])
                if color in NODE_BORDER_COLORS
            }
            node_colors = []
            for paper in papers:
                paper_id = str(paper.get("openalexId") or "")
                normalized_id = _normalize_openalex_id(paper_id)
                border_color = node_colors_by_normalized_paper_id.get(normalized_id)
                if not border_color:
                    continue
                if requested_paper_ids and normalized_id not in requested_paper_ids:
                    continue
                if requested_colors and border_color not in requested_colors:
                    continue
                node_colors.append({
                    "paperId": paper_id,
                    "title": str(paper.get("title") or "Untitled paper"),
                    "borderColor": border_color,
                })
            result = {"status": "completed", "nodeColors": node_colors}
            await _emit(event_emitter, "tool_completed", {
                "name": name,
                "status": result["status"],
                "result": _compact_tool_result_for_event(result),
            })
            return result

        if name == "update_timeline_node_colors":
            if not _allows_timeline_node_color_mutation(req.question):
                result = {
                    "status": "error",
                    "message": "Node colors require an explicit color request in the current message.",
                }
                await _emit(event_emitter, "tool_completed", {"name": name, "status": "error", "result": result})
                return result

            changes: list[dict[str, str | None]] = []
            skipped: list[dict[str, str]] = []
            seen_paper_ids: set[str] = set()
            raw_updates = tool_input.get("updates") if isinstance(tool_input.get("updates"), list) else []
            for raw_update in raw_updates[:10]:
                if not isinstance(raw_update, dict):
                    skipped.append({"paperId": "<unknown>", "reason": "invalid_node_color_payload"})
                    continue
                canonical_paper_id = resolve_current_paper_id(raw_update.get("paperId"))
                if not canonical_paper_id:
                    skipped.append({"paperId": str(raw_update.get("paperId") or "<unknown>"), "reason": "paper_not_in_timeline"})
                    continue
                normalized_id = _normalize_openalex_id(canonical_paper_id)
                if normalized_id in seen_paper_ids:
                    skipped.append({"paperId": canonical_paper_id, "reason": "node_color_duplicate"})
                    continue
                border_color = raw_update.get("borderColor")
                if border_color is not None and border_color not in NODE_BORDER_COLORS:
                    skipped.append({"paperId": canonical_paper_id, "reason": "invalid_node_border_color"})
                    continue
                seen_paper_ids.add(normalized_id)
                if node_colors_by_normalized_paper_id.get(normalized_id) == border_color:
                    skipped.append({"paperId": canonical_paper_id, "reason": "node_color_unchanged"})
                    continue
                if border_color is None:
                    node_colors_by_normalized_paper_id.pop(normalized_id, None)
                else:
                    node_colors_by_normalized_paper_id[normalized_id] = border_color
                changes.append({"paperId": canonical_paper_id, "borderColor": border_color})

            result = {"status": "completed", "nodeColorChanges": changes, "skipped": skipped}
            await _emit(event_emitter, "tool_completed", {
                "name": name,
                "status": result["status"],
                "result": _compact_tool_result_for_event(result),
            })
            return result

        if name == "read_timeline_notes":
            requested_ids = {
                str(note_id).strip()
                for note_id in tool_input.get("noteIds", [])
                if isinstance(note_id, str) and note_id.strip()
            }
            requested_colors = {
                color for color in tool_input.get("colors", [])
                if color in NOTE_COLORS
            }
            requested_kinds = {
                kind for kind in tool_input.get("kinds", [])
                if kind in NOTE_KINDS
            }
            query = str(tool_input.get("query") or "").strip().lower()[:300]
            try:
                limit = max(1, min(int(tool_input.get("limit") or 30), 50))
            except (TypeError, ValueError):
                limit = 30

            matching_notes = []
            for note in notes_by_id.values():
                if requested_ids and note["id"] not in requested_ids:
                    continue
                if requested_colors and note["color"] not in requested_colors:
                    continue
                if requested_kinds and note["kind"] not in requested_kinds:
                    continue
                if query and query not in note["text"].lower():
                    continue
                connections = [
                    {
                        "paperId": connection["paperId"],
                        "relation": connection["relation"],
                    }
                    for connection in note_connections
                    if connection["noteId"] == note["id"]
                ]
                matching_notes.append({**note, "connections": connections})
                if len(matching_notes) >= limit:
                    break
            result = {"status": "completed", "notes": matching_notes}
            await _emit(event_emitter, "tool_completed", {
                "name": name,
                "status": result["status"],
                "result": _compact_tool_result_for_event(result),
            })
            return result

        if name in {"create_timeline_notes", "update_timeline_notes"} and not _allows_timeline_note_mutation(
            req.question,
            has_recent_note_action,
        ):
            result = {
                "status": "error",
                "message": "Canvas note changes require an explicit request in the current message.",
            }
            await _emit(event_emitter, "tool_completed", {"name": name, "status": "error", "result": result})
            return result

        if name == "create_timeline_notes":
            created_notes: list[dict[str, str]] = []
            connections: list[dict[str, str]] = []
            skipped: list[dict[str, str]] = []
            raw_notes = tool_input.get("notes") if isinstance(tool_input.get("notes"), list) else []
            for raw_note in raw_notes[:5]:
                if not isinstance(raw_note, dict):
                    skipped.append({"noteId": "<new note>", "reason": "invalid_note_payload"})
                    continue
                text = str(raw_note.get("text") or "").strip()
                kind = raw_note.get("kind") if raw_note.get("kind") in NOTE_KINDS else "field_note"
                color = raw_note.get("color") if raw_note.get("color") in NOTE_COLORS else "paper"
                if not text:
                    skipped.append({"noteId": "<new note>", "reason": "empty_note_text"})
                    continue
                if len(notes_by_id) >= MAX_TIMELINE_NOTES:
                    skipped.append({"noteId": "<new note>", "reason": "note_limit_reached"})
                    continue
                note = {
                    "id": f"note-agent-{uuid4().hex[:12]}",
                    "text": text[:12_000],
                    "kind": kind,
                    "color": color,
                }
                notes_by_id[note["id"]] = note
                created_notes.append(note)
                relation = raw_note.get("relation") if raw_note.get("relation") in NOTE_RELATIONS else "about"
                paper_ids = raw_note.get("connectToPaperIds") if isinstance(raw_note.get("connectToPaperIds"), list) else []
                for paper_id in paper_ids[:5]:
                    connection = add_note_connection(note["id"], paper_id, relation, skipped)
                    if connection:
                        connections.append(connection)
            result = {
                "status": "completed",
                "createdNotes": created_notes,
                "updatedNotes": [],
                "deletedNoteIds": [],
                "connections": connections,
                "disconnections": [],
                "skipped": skipped,
            }
            await _emit(event_emitter, "tool_completed", {
                "name": name,
                "status": result["status"],
                "result": _compact_tool_result_for_event(result),
            })
            return result

        if name == "update_timeline_notes":
            updated_notes: list[dict[str, Any]] = []
            deleted_note_ids: list[str] = []
            connections: list[dict[str, str]] = []
            disconnections: list[dict[str, str]] = []
            skipped: list[dict[str, str]] = []
            raw_updates = tool_input.get("updates") if isinstance(tool_input.get("updates"), list) else []
            for raw_update in raw_updates[:10]:
                if not isinstance(raw_update, dict):
                    skipped.append({"noteId": "<unknown>", "reason": "invalid_note_update"})
                    continue
                note_id = str(raw_update.get("noteId") or "").strip()
                note = notes_by_id.get(note_id)
                if not note:
                    skipped.append({"noteId": note_id or "<unknown>", "reason": "note_not_found"})
                    continue
                patch: dict[str, str] = {}
                if "text" in raw_update:
                    text = str(raw_update.get("text") or "").strip()
                    if not text:
                        skipped.append({"noteId": note_id, "reason": "empty_note_text"})
                    else:
                        patch["text"] = text[:12_000]
                if "kind" in raw_update:
                    if raw_update["kind"] in NOTE_KINDS:
                        patch["kind"] = raw_update["kind"]
                    else:
                        skipped.append({"noteId": note_id, "reason": "invalid_note_kind"})
                if "color" in raw_update:
                    if raw_update["color"] in NOTE_COLORS:
                        patch["color"] = raw_update["color"]
                    else:
                        skipped.append({"noteId": note_id, "reason": "invalid_note_color"})
                if not patch:
                    continue
                note.update(patch)
                updated_notes.append({"noteId": note_id, "patch": patch})

            raw_deletions = tool_input.get("deleteNoteIds") if isinstance(tool_input.get("deleteNoteIds"), list) else []
            for raw_note_id in raw_deletions[:10]:
                note_id = str(raw_note_id or "").strip()
                if note_id not in notes_by_id:
                    skipped.append({"noteId": note_id or "<unknown>", "reason": "note_not_found"})
                    continue
                del notes_by_id[note_id]
                note_connections[:] = [connection for connection in note_connections if connection["noteId"] != note_id]
                deleted_note_ids.append(note_id)

            raw_connections = tool_input.get("connections") if isinstance(tool_input.get("connections"), list) else []
            for raw_connection in raw_connections[:15]:
                if not isinstance(raw_connection, dict):
                    skipped.append({"noteId": "<unknown>", "reason": "invalid_note_connection"})
                    continue
                note_id = str(raw_connection.get("noteId") or "").strip()
                connection = add_note_connection(note_id, raw_connection.get("paperId"), raw_connection.get("relation"), skipped)
                if connection:
                    connections.append(connection)

            raw_disconnections = tool_input.get("disconnections") if isinstance(tool_input.get("disconnections"), list) else []
            for raw_connection in raw_disconnections[:15]:
                if not isinstance(raw_connection, dict):
                    skipped.append({"noteId": "<unknown>", "reason": "invalid_note_connection"})
                    continue
                note_id = str(raw_connection.get("noteId") or "").strip()
                canonical_paper_id = resolve_current_paper_id(raw_connection.get("paperId"))
                if note_id not in notes_by_id:
                    skipped.append({"noteId": note_id or "<unknown>", "reason": "note_not_found"})
                    continue
                if not canonical_paper_id:
                    skipped.append({"noteId": note_id, "reason": "paper_not_in_timeline"})
                    continue
                before = len(note_connections)
                note_connections[:] = [
                    connection
                    for connection in note_connections
                    if not (
                        connection["noteId"] == note_id
                        and _normalize_openalex_id(connection["paperId"]) == _normalize_openalex_id(canonical_paper_id)
                    )
                ]
                if len(note_connections) == before:
                    skipped.append({"noteId": note_id, "reason": "note_connection_not_found"})
                    continue
                disconnections.append({"noteId": note_id, "paperId": canonical_paper_id})

            result = {
                "status": "completed",
                "createdNotes": [],
                "updatedNotes": updated_notes,
                "deletedNoteIds": deleted_note_ids,
                "connections": connections,
                "disconnections": disconnections,
                "skipped": skipped,
            }
            await _emit(event_emitter, "tool_completed", {
                "name": name,
                "status": result["status"],
                "result": _compact_tool_result_for_event(result),
            })
            return result

        requested_paper_id = str(tool_input.get("paperId") or primary_paper_id or "")
        paper = _paper_by_id(papers, requested_paper_id)
        canonical_paper_id = paper.get("openalexId") if paper else requested_paper_id

        if name in {"check_paper_access", "retrieve_paper_content", "search_paper_content"} and not paper:
            result = {"status": "error", "message": "Tool requested a paper that is not present in this graph."}
            await _emit(event_emitter, "tool_completed", {"name": name, "status": "error", "result": result})
            return result

        if name == "check_paper_access":
            result = await PaperAccessChecker().check(canonical_paper_id)
            await _emit(event_emitter, "tool_completed", {
                "name": name,
                "status": result.get("accessStatus") or result.get("status") or "completed",
                "result": _compact_tool_result_for_event(result),
            })
            return result

        if name == "retrieve_paper_content":
            if not _allows_paper_retrieval(req.question, tool_input, pending_action, canonical_paper_id):
                result = {
                    "status": "needs_confirmation",
                    "requiresConfirmation": True,
                    "message": "Please confirm that you want me to access and index the complete paper.",
                    "paperId": canonical_paper_id,
                }
                await _emit(event_emitter, "tool_completed", {"name": name, "status": result["status"], "result": result})
                return result
            try:
                result = await PaperIngestionService().ingest(canonical_paper_id, paper, billing_ip=request_ip)
            except IngestionError as exc:
                result = {
                    "status": "unavailable" if exc.code in {"access_provider_failed", "no_extractable_text"} else "error",
                    "message": str(exc),
                    "errorCode": exc.code,
                    "paperId": canonical_paper_id,
                }
            await _emit(event_emitter, "tool_completed", {
                "name": name,
                "status": result.get("status") or "completed",
                "result": _compact_tool_result_for_event(result),
            })
            return result

        if name == "search_paper_content":
            if retrieval is None:
                result = {"status": "error", "message": "Paper retrieval requires a saved graph context."}
            else:
                query = str(tool_input.get("query") or req.question).strip()[:1000]
                try:
                    search_result = await retrieval.search_paper(canonical_paper_id, query, limit=6, billing_ip=request_ip)
                    result = {
                        "status": "completed",
                        **search_result,
                        "citations": _tool_citations(search_result),
                    }
                except RetrievalError as exc:
                    result = {"status": "error", "message": str(exc)}
            await _emit(event_emitter, "tool_completed", {
                "name": name,
                "status": result.get("status") or "completed",
                "result": _compact_tool_result_for_event(result),
            })
            if result.get("citations"):
                await _emit(event_emitter, "citations", {"citations": result["citations"]})
            return result

        result = {"status": "error", "message": "Unknown tool requested."}
        await _emit(event_emitter, "tool_completed", {"name": name, "status": "error", "result": result})
        return result

    try:
        await _emit(event_emitter, "status", {"message": "Thinking with timeline tools"})
        result = await _llm.chat_about_timeline_agentic(
            papers,
            req.question.strip(),
            tool_runner=run_global_tool,
            text_emitter=(
                (lambda text: _emit(event_emitter, "text_delta", {"text": text}))
                if event_emitter
                else None
            ),
            ip=request_ip,
            history=context.history if context else None,
            summary=context.summary if context else None,
            mentioned_paper_ids=mentioned_paper_ids,
            pending_action=pending_action,
            timeline_note_index=timeline_note_index,
        )
    except LLMParseError as e:
        logger.warning("Timeline chat failed for %s papers", len(req.papers), exc_info=e)
        raise HTTPException(status_code=502, detail="Timeline chat service returned an invalid response.") from e
    except Exception as e:
        logger.warning("Timeline chat upstream failed for %s papers", len(req.papers), exc_info=e)
        raise HTTPException(status_code=502, detail="Timeline chat service is currently unavailable.") from e

    result["highlightedPaperIds"] = [
        paper_id for paper_id in (result.get("highlightedPaperIds") or [])
        if paper_id in valid_ids
    ][:5]
    if result.get("text") and not result.get("textStreamed"):
        await _emit(event_emitter, "text_delta", {"text": result["text"]})
    if result.get("citations"):
        await _emit(event_emitter, "citations", {"citations": result["citations"]})

    if context and memory and req.userId:
        tool_uses = result.get("toolUses") or []
        if result.get("highlightedPaperIds"):
            tool_uses.append({
                "name": "global_response",
                "highlightedPaperIds": result.get("highlightedPaperIds") or [],
            })
        try:
            assistant = await memory.append(
                context,
                req.userId,
                "assistant",
                result.get("text") or "",
                tool_uses=tool_uses,
                citations=result.get("citations") or [],
            )
            result["sessionId"] = context.session["id"]
            try:
                await memory.maybe_summarize(
                    context,
                    req.userId,
                    int(assistant["sequence_number"]),
                    _llm,
                    request_ip,
                )
            except SupabaseAPIError as exc:
                logger.warning("Global chat summary update failed", exc_info=exc)
        except SupabaseAPIError as exc:
            logger.warning("Global assistant message persistence failed", exc_info=exc)
            raise HTTPException(status_code=502, detail="Chat response could not be saved.") from exc

    await _emit(event_emitter, "message_completed", {"response": result})
    return result


async def _global_chat_event_stream(req: GlobalChatRequest, request_ip: str) -> AsyncIterator[str]:
    queue: asyncio.Queue[tuple[str, dict[str, Any]] | None] = asyncio.Queue(maxsize=64)

    async def emit(event_type: str, payload: dict[str, Any]) -> None:
        await queue.put((event_type, payload))

    async def run() -> None:
        try:
            await _run_global_chat(req, request_ip, emit)
        except HTTPException as exc:
            await emit("error", {"detail": exc.detail, "statusCode": exc.status_code})
        except Exception:
            logger.exception("Streaming global chat failed")
            await emit("error", {"detail": "Chat failed.", "statusCode": 500})
        finally:
            await queue.put(None)

    task = asyncio.create_task(run())
    try:
        while True:
            item = await queue.get()
            if item is None:
                break
            yield _sse(item[0], item[1])
    finally:
        if not task.done():
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task


@router.post("/graphs/{graph_id}/chat/session", response_model=ChatSessionResponse)
async def open_chat_session(graph_id: str, req: ChatSessionRequest):
    try:
        _, _, _, context = await _load_persistent_context(
            graph_id,
            req.userId,
            req.scope,
            req.paperOpenalexId.upper() if req.paperOpenalexId else None,
            message_limit=100,
        )
        return ChatSessionResponse(**serialize_chat_context(context))
    except SupabaseAPIError as exc:
        logger.warning("Chat session restore failed for graph_id=%r", graph_id, exc_info=exc)
        raise HTTPException(status_code=502, detail="Chat history is currently unavailable.") from exc


@router.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest, request: Request):
    if not req.question.strip():
        raise HTTPException(status_code=400, detail="question required")

    request_ip = get_request_ip(request)
    result = await _run_paper_chat(req, request_ip)

    try:
        return ChatResponse(**result)
    except ValidationError as e:
        logger.warning("Paper chat produced invalid payload for paper_id=%r", req.paperId, exc_info=e)
        raise HTTPException(status_code=502, detail="Chat service returned an invalid payload.") from e


@router.post("/chat/stream")
async def chat_stream(req: ChatRequest, request: Request):
    if not req.question.strip():
        raise HTTPException(status_code=400, detail="question required")
    request_ip = get_request_ip(request)
    return StreamingResponse(
        _paper_chat_event_stream(req, request_ip),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-store",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/chat/global/suggestions", response_model=list[str])
async def suggest_questions(papers: list[PaperSummary], request: Request):
    if not papers:
        return []
    if len(papers) > MAX_TIMELINE_PAPERS:
        raise HTTPException(status_code=400, detail=f"At most {MAX_TIMELINE_PAPERS} papers are allowed.")
    request_ip = get_request_ip(request)
    await limiter.claim_request(request_ip, "chat_global_suggestions")
    try:
        return await _llm.suggest_timeline_questions([p.model_dump() for p in papers], ip=request_ip)
    except LLMParseError as e:
        logger.warning("Timeline suggestion generation failed for %s papers", len(papers), exc_info=e)
        return []


@router.post("/chat/global", response_model=GlobalChatResponse)
async def chat_global(req: GlobalChatRequest, request: Request):
    if not req.question.strip():
        raise HTTPException(status_code=400, detail="question required")
    if not req.papers:
        raise HTTPException(status_code=400, detail="papers required")

    request_ip = get_request_ip(request)
    result = await _run_global_chat(req, request_ip)

    try:
        return GlobalChatResponse(**result)
    except ValidationError as e:
        logger.warning("Timeline chat produced invalid payload for %s papers", len(req.papers), exc_info=e)
        raise HTTPException(status_code=502, detail="Timeline chat service returned an invalid payload.") from e


@router.post("/chat/global/stream")
async def chat_global_stream(req: GlobalChatRequest, request: Request):
    if not req.question.strip():
        raise HTTPException(status_code=400, detail="question required")
    if not req.papers:
        raise HTTPException(status_code=400, detail="papers required")
    request_ip = get_request_ip(request)
    return StreamingResponse(
        _global_chat_event_stream(req, request_ip),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-store",
            "X-Accel-Buffering": "no",
        },
    )
