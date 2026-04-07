from typing import Literal, Optional
from pydantic import BaseModel, Field


class SearchRequest(BaseModel):
    query: str
    seedOpenalexId: Optional[str] = None


class ExpandRequest(BaseModel):
    paperId: str
    conceptContext: str


class ChatRequest(BaseModel):
    paperId: str
    title: str
    year: Optional[int] = None
    summary: str = ""
    authors: list[str] = Field(default_factory=list)
    question: str


class GraphPaper(BaseModel):
    openalexId: str
    title: str
    year: Optional[int] = None
    summary: str = ""
    detail: str = ""
    authors: list[str] = Field(default_factory=list)
    doi: Optional[str] = None


class GraphEdge(BaseModel):
    parentOpenalexId: str
    childOpenalexId: str
    relation: Literal["influenced"] = "influenced"


class SeedCandidate(BaseModel):
    openalexId: str
    title: str
    year: Optional[int] = None
    reason: Optional[str] = None


class SearchMeta(BaseModel):
    query: str
    mode: Literal["resolved", "needs_disambiguation"] = "resolved"
    confidence: Optional[Literal["high", "medium", "low"]] = None
    cacheHit: bool = False


class LineageGraphResponse(BaseModel):
    seedPaperId: Optional[str] = None
    papers: list[GraphPaper] = Field(default_factory=list)
    edges: list[GraphEdge] = Field(default_factory=list)
    rootIds: list[str] = Field(default_factory=list)
    meta: SearchMeta
    disambiguation: Optional[list[SeedCandidate]] = None


class ChatSuggestion(BaseModel):
    topic: str
    query: str
    nodeCount: int = 4


class ChatResponse(BaseModel):
    text: str
    suggestion: Optional[ChatSuggestion] = None
