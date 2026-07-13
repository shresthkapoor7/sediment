from __future__ import annotations

import logging
import re

from fastapi import APIRouter, HTTPException, Query, Request

from ..db.supabase import SupabaseAPIError, SupabaseClient, SupabaseConfigError
from ..models import (
    MAX_PAPER_CONTENT_CHUNKS,
    PaperAccessResponse,
    PaperContentResponse,
    RetrievePaperRequest,
    RetrievePaperResponse,
    SearchPaperContentRequest,
    SearchPaperContentResponse,
)
from ..services.paper_access import PaperAccessChecker
from ..services.paper_ingestion import IngestionError, PaperIngestionService
from ..services.paper_retrieval import PaperRetrievalService, RetrievalError
from ..services.usage_limiter import limiter
from .search import get_request_ip

router = APIRouter()
logger = logging.getLogger(__name__)
OPENALEX_ID = re.compile(r"^W\d+$", re.IGNORECASE)


def _db() -> SupabaseClient:
    try:
        return SupabaseClient()
    except SupabaseConfigError as exc:
        raise HTTPException(status_code=503, detail="Paper storage is not configured.") from exc


@router.get("/papers/{openalex_id}/access", response_model=PaperAccessResponse)
async def check_paper_access(openalex_id: str, request: Request):
    normalized_id = openalex_id.strip().upper()
    if not OPENALEX_ID.fullmatch(normalized_id):
        raise HTTPException(status_code=400, detail="Invalid OpenAlex work ID.")

    await limiter.claim_request(get_request_ip(request), "paper_access")
    try:
        result = await PaperAccessChecker().check(normalized_id)
        return PaperAccessResponse(**result)
    except Exception as exc:
        logger.warning("Paper access check failed for openalex_id=%r", normalized_id, exc_info=exc)
        return PaperAccessResponse(
            openalexId=normalized_id,
            accessStatus="failed",
            ingestionStatus="failed",
            requiresConfirmation=False,
            message="The access check failed. Try again later.",
        )


def _paper_from_graph(graph_data: object, openalex_id: str) -> dict | None:
    if not isinstance(graph_data, dict):
        return None
    nodes = graph_data.get("nodes")
    if not isinstance(nodes, dict):
        return None
    for node in nodes.values():
        paper = node.get("paper") if isinstance(node, dict) else None
        if isinstance(paper, dict) and paper.get("openalexId") == openalex_id:
            return paper
    return None


def _paper_ids_from_graph(graph_data: object) -> list[str]:
    if not isinstance(graph_data, dict) or not isinstance(graph_data.get("nodes"), dict):
        return []
    paper_ids: list[str] = []
    for node in graph_data["nodes"].values():
        paper = node.get("paper") if isinstance(node, dict) else None
        openalex_id = paper.get("openalexId") if isinstance(paper, dict) else None
        if isinstance(openalex_id, str) and OPENALEX_ID.fullmatch(openalex_id):
            paper_ids.append(openalex_id.upper())
    return list(dict.fromkeys(paper_ids))


@router.post(
    "/graphs/{graph_id}/papers/{openalex_id}/retrieve",
    response_model=RetrievePaperResponse,
)
async def retrieve_paper_content(
    graph_id: str,
    openalex_id: str,
    req: RetrievePaperRequest,
    request: Request,
):
    normalized_id = openalex_id.strip().upper()
    if not OPENALEX_ID.fullmatch(normalized_id):
        raise HTTPException(status_code=400, detail="Invalid OpenAlex work ID.")
    if not req.confirmed:
        raise HTTPException(status_code=400, detail="Explicit confirmation is required.")

    request_ip = get_request_ip(request)
    await limiter.claim_request(request_ip, "paper_retrieve")
    try:
        graph = await _db().get_graph(graph_id, req.userId)
    except SupabaseAPIError as exc:
        logger.warning("Graph ownership check failed for graph_id=%r", graph_id, exc_info=exc)
        raise HTTPException(status_code=502, detail="Could not verify the saved graph.") from exc
    if not graph:
        raise HTTPException(status_code=404, detail="Graph not found.")

    graph_paper = _paper_from_graph(graph.get("data"), normalized_id)
    if not graph_paper:
        raise HTTPException(status_code=404, detail="Paper is not present in this graph.")

    try:
        result = await PaperIngestionService().ingest(normalized_id, graph_paper, billing_ip=request_ip)
        return RetrievePaperResponse(**result)
    except IngestionError as exc:
        logger.warning(
            "Paper ingestion failed with code=%s for openalex_id=%r",
            exc.code,
            normalized_id,
        )
        status_code = 503 if exc.code in {"embedding_not_configured", "pdf_parser_unavailable"} else 502
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc
    except SupabaseAPIError as exc:
        logger.warning("Paper ingestion storage failed for openalex_id=%r", normalized_id, exc_info=exc)
        raise HTTPException(status_code=502, detail="Paper ingestion storage failed.") from exc


@router.get(
    "/graphs/{graph_id}/papers/{openalex_id}/content",
    response_model=PaperContentResponse,
)
async def get_cached_paper_content(
    graph_id: str,
    openalex_id: str,
    user_id: str = Query(alias="userId", min_length=1),
):
    normalized_id = openalex_id.strip().upper()
    if not OPENALEX_ID.fullmatch(normalized_id):
        raise HTTPException(status_code=400, detail="Invalid OpenAlex work ID.")

    db = _db()
    try:
        graph = await db.get_graph(graph_id, user_id)
        if not graph:
            raise HTTPException(status_code=404, detail="Graph not found.")
        graph_paper = _paper_from_graph(graph.get("data"), normalized_id)
        if not graph_paper:
            raise HTTPException(status_code=404, detail="Paper is not present in this graph.")

        document = await db.get_ready_paper_document(normalized_id)
        if not document:
            raise HTTPException(status_code=404, detail="Complete paper text is not cached.")
        chunks = await db.list_paper_document_chunks(
            document["id"],
            limit=MAX_PAPER_CONTENT_CHUNKS + 1,
        )
    except SupabaseAPIError as exc:
        logger.warning("Cached paper content lookup failed for openalex_id=%r", normalized_id, exc_info=exc)
        raise HTTPException(status_code=502, detail="Paper content is currently unavailable.") from exc

    return PaperContentResponse(
        openalexId=normalized_id,
        documentId=document["id"],
        title=str(graph_paper.get("title") or normalized_id),
        sourceType=str(document.get("source_type") or "cached_text"),
        sourceUrl=document.get("source_url"),
        chunks=[
            {
                "chunkIndex": chunk["chunk_index"],
                "content": chunk["content"],
                "section": chunk.get("section"),
                "sectionType": chunk.get("section_type"),
                "pageStart": chunk.get("page_start"),
                "pageEnd": chunk.get("page_end"),
            }
            for chunk in chunks[:MAX_PAPER_CONTENT_CHUNKS]
        ],
        truncated=len(chunks) > MAX_PAPER_CONTENT_CHUNKS,
    )


@router.post(
    "/graphs/{graph_id}/papers/{openalex_id}/search",
    response_model=SearchPaperContentResponse,
)
async def search_paper_content(
    graph_id: str,
    openalex_id: str,
    req: SearchPaperContentRequest,
    request: Request,
):
    normalized_id = openalex_id.strip().upper()
    if not OPENALEX_ID.fullmatch(normalized_id):
        raise HTTPException(status_code=400, detail="Invalid OpenAlex work ID.")

    request_ip = get_request_ip(request)
    await limiter.claim_request(request_ip, "paper_search")
    db = _db()
    try:
        graph = await db.get_graph(graph_id, req.userId)
        if not graph:
            raise HTTPException(status_code=404, detail="Graph not found.")
        if not _paper_from_graph(graph.get("data"), normalized_id):
            raise HTTPException(status_code=404, detail="Paper is not present in this graph.")
        result = await PaperRetrievalService(db).search_paper(normalized_id, req.query, limit=req.limit, billing_ip=request_ip)
        return SearchPaperContentResponse(**result)
    except RetrievalError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except SupabaseAPIError as exc:
        logger.warning("Paper retrieval failed for openalex_id=%r", normalized_id, exc_info=exc)
        raise HTTPException(status_code=502, detail="Paper retrieval storage failed.") from exc


@router.post(
    "/graphs/{graph_id}/papers/search",
    response_model=SearchPaperContentResponse,
)
async def search_graph_paper_content(
    graph_id: str,
    req: SearchPaperContentRequest,
    request: Request,
):
    request_ip = get_request_ip(request)
    await limiter.claim_request(request_ip, "graph_paper_search")
    db = _db()
    try:
        graph = await db.get_graph(graph_id, req.userId)
        if not graph:
            raise HTTPException(status_code=404, detail="Graph not found.")
        openalex_ids = _paper_ids_from_graph(graph.get("data"))
        result = await PaperRetrievalService(db).search_graph(openalex_ids, req.query, limit=req.limit, billing_ip=request_ip)
        return SearchPaperContentResponse(**result)
    except RetrievalError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except SupabaseAPIError as exc:
        logger.warning("Graph paper retrieval failed for graph_id=%r", graph_id, exc_info=exc)
        raise HTTPException(status_code=502, detail="Paper retrieval storage failed.") from exc
