"""Plain paper lookup against OpenAlex. No model calls, so it costs no credits."""

import logging
import re
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from ..config import settings
from ..models import GraphPaper
from ..services.openalex import OpenAlexClient, OpenAlexError

router = APIRouter()
logger = logging.getLogger(__name__)

MAX_QUERY_LENGTH = 300
SUMMARY_LENGTH = 220

_OPENALEX_ID = re.compile(r"(?:^|openalex\.org/(?:works/)?)(W\d{4,})\s*$", re.IGNORECASE)
_ARXIV = re.compile(r"(?:arxiv\.org/(?:abs|pdf)/|^arxiv:\s*)(\d{4}\.\d{4,5})(?:v\d+)?", re.IGNORECASE)
_DOI = re.compile(r"(10\.\d{4,9}/[^\s?#]+)", re.IGNORECASE)


def resolve_identifier(query: str) -> Optional[str]:
    """Return the OpenAlex work key for a pasted ID, DOI or arXiv link, or None for free text."""
    text = query.strip()
    openalex_match = _OPENALEX_ID.search(text)
    if openalex_match:
        return openalex_match.group(1).upper()
    arxiv_match = _ARXIV.search(text)
    if arxiv_match:
        return f"doi:10.48550/arXiv.{arxiv_match.group(1)}"
    doi_match = _DOI.search(text)
    if doi_match:
        return f"doi:{doi_match.group(1).rstrip('.,;)')}"
    return None


def summarize_abstract(abstract: str) -> str:
    """A short card summary cut from the abstract, ending on a sentence where possible."""
    text = " ".join((abstract or "").split())
    if len(text) <= SUMMARY_LENGTH:
        return text
    clipped = text[:SUMMARY_LENGTH]
    sentence_end = max(clipped.rfind(". "), clipped.rfind("? "), clipped.rfind("! "))
    if sentence_end >= 80:
        return clipped[: sentence_end + 1]
    return clipped.rsplit(" ", 1)[0].rstrip(",;:") + "…"


def to_graph_paper(work: dict) -> GraphPaper:
    detail = work.get("detail") or ""
    return GraphPaper(
        openalexId=work["openalexId"],
        title=work["title"],
        year=work.get("year"),
        summary=summarize_abstract(detail),
        detail=detail,
        authors=work.get("authors") or [],
        doi=work.get("doi"),
        oaUrl=work.get("oaUrl"),
        isOa=bool(work.get("isOa")),
        oaStatus=work.get("oaStatus"),
        hasFulltext=bool(work.get("hasFulltext")),
        hasContentPdf=bool(work.get("hasContentPdf")),
        hasContentTei=bool(work.get("hasContentTei")),
        oaLicense=work.get("oaLicense"),
        concepts=work.get("concepts") or [],
        type=work.get("type"),
        citedByCount=work.get("citedByCount") or 0,
        referencesCount=work.get("referencedWorksCount") or 0,
    )


@router.get("/papers/search", response_model=list[GraphPaper])
async def search_papers(
    q: str = Query(..., min_length=2, max_length=MAX_QUERY_LENGTH),
    limit: int = Query(10, ge=1, le=20),
):
    query = q.strip()
    if len(query) < 2:
        raise HTTPException(status_code=400, detail="query required")

    identifier = resolve_identifier(query)
    try:
        async with OpenAlexClient(
            api_key=settings.openalex_api_key,
            mailto=settings.openalex_mailto,
        ) as openalex:
            if identifier:
                try:
                    work = await openalex.fetch_work(identifier)
                except OpenAlexError:
                    # An unknown DOI or ID is an empty result, not an outage.
                    work = None
                works = [work] if work else []
            else:
                works = (await openalex.search_papers(query, limit=limit))[:limit]
    except OpenAlexError as e:
        logger.warning("Paper search failed for query=%r", query, exc_info=e)
        raise HTTPException(status_code=502, detail="Paper search is currently unavailable.") from e

    return [to_graph_paper(work) for work in works]
