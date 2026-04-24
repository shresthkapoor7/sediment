from typing import Any, Literal, Optional
from pydantic import BaseModel, Field
from .config import settings


class TraversalSettings(BaseModel):
    depth: Optional[int] = None
    breadth: Optional[int] = None
    referenceLimit: Optional[int] = None
    topN: Optional[int] = None


class SearchRequest(BaseModel):
    query: str
    seedOpenalexId: Optional[str] = None
    settings: Optional[TraversalSettings] = None


class ExpandRequest(BaseModel):
    paperId: str
    conceptContext: str
    settings: Optional[TraversalSettings] = None


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
    oaUrl: Optional[str] = None
    concepts: list[str] = Field(default_factory=list)
    type: Optional[str] = None
    citedByCount: int = 0
    referencesCount: int = 0


class GraphEdge(BaseModel):
    parentOpenalexId: str
    childOpenalexId: str
    relation: Literal["influenced", "inferred"] = "influenced"


class SeedCandidate(BaseModel):
    openalexId: str
    title: str
    year: Optional[int] = None
    reason: Optional[str] = None


class SearchMeta(BaseModel):
    query: str
    mode: Literal["resolved", "resolved_inferred", "needs_disambiguation"] = "resolved"
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


class PaperSummary(BaseModel):
    openalexId: str
    title: str
    year: Optional[int] = None
    summary: str = ""


class GlobalChatRequest(BaseModel):
    papers: list[PaperSummary]
    question: str


class GlobalChatResponse(BaseModel):
    text: str
    highlightedPaperIds: list[str] = Field(default_factory=list)
    suggestion: Optional[ChatSuggestion] = None


class UserUpsertRequest(BaseModel):
    id: str


class UserRecord(BaseModel):
    id: str
    created_at: str
    last_seen: str


class SavedGraphMetadata(BaseModel):
    title: str = ""
    nodeCount: int = 0
    lastOpenedAt: Optional[str] = None
    appVersion: str = Field(default_factory=lambda: settings.app_version)


class SaveGraphRequest(BaseModel):
    userId: str
    query: str
    data: dict[str, Any]
    seedPaperId: Optional[str] = None
    metadata: SavedGraphMetadata = Field(default_factory=SavedGraphMetadata)


class UpdateGraphRequest(BaseModel):
    userId: str
    query: Optional[str] = None
    data: Optional[dict[str, Any]] = None
    seedPaperId: Optional[str] = None
    metadata: Optional[SavedGraphMetadata] = None


class GraphRecord(BaseModel):
    id: str
    userId: str
    query: str
    data: dict[str, Any]
    metadata: SavedGraphMetadata = Field(default_factory=SavedGraphMetadata)
    seedPaperId: Optional[str] = None
    isPublic: bool = False
    shareId: Optional[str] = None
    createdAt: str
    updatedAt: str


class GraphListItem(BaseModel):
    id: str
    query: str
    seedPaperId: Optional[str] = None
    metadata: SavedGraphMetadata = Field(default_factory=SavedGraphMetadata)
    createdAt: str
    updatedAt: str


class ShareGraphResponse(BaseModel):
    shareId: str
    shareUrl: str


class SharedGraphRecord(BaseModel):
    id: str
    query: str
    data: dict[str, Any]
    metadata: SavedGraphMetadata = Field(default_factory=SavedGraphMetadata)
    seedPaperId: Optional[str] = None
    isPublic: bool = True
    shareId: Optional[str] = None
    createdAt: str
    updatedAt: str
