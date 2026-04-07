from pydantic import BaseModel
from typing import Optional


class SearchRequest(BaseModel):
    query: str


class ExpandRequest(BaseModel):
    paperId: str          # Semantic Scholar paper ID
    conceptContext: str   # original query for context-aware ranking


class LLMPaper(BaseModel):
    title: str
    year: int
    summary: str
    detail: Optional[str] = None
    authors: Optional[list[str]] = None
    arxivId: Optional[str] = None
    s2Id: Optional[str] = None
    parentIndex: Optional[int] = None  # 0-based index into returned array


class LineageResponse(BaseModel):
    papers: list[LLMPaper]
