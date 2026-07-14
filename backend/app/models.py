import json
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .config import settings

MAX_QUERY_LENGTH = 300
MAX_OPENALEX_ID_LENGTH = 64
MAX_TITLE_LENGTH = 500
MAX_SUMMARY_LENGTH = 4_000
MAX_DETAIL_LENGTH = 12_000
MAX_CONCEPTS = 20
MAX_CONCEPT_CONTEXT_LENGTH = 500
MAX_CHAT_QUESTION_LENGTH = 1_000
MAX_SELECTED_EXCERPT_LENGTH = 6_000
MAX_PAPER_CONTENT_CHUNKS = 100
MAX_TIMELINE_PAPERS = 25
MAX_USER_ID_LENGTH = 128
MAX_GRAPH_ID_LENGTH = 128
MAX_SHARE_ID_LENGTH = 64
MAX_METADATA_TITLE_LENGTH = 200
MAX_GRAPH_JSON_BYTES = 1_000_000


class StrictRequestModel(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")


class TraversalSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    depth: Optional[int] = None
    breadth: Optional[int] = None
    referenceLimit: Optional[int] = None
    topN: Optional[int] = None


class SearchRequest(StrictRequestModel):
    query: str = Field(min_length=1, max_length=MAX_QUERY_LENGTH)
    seedOpenalexId: Optional[str] = Field(default=None, max_length=MAX_OPENALEX_ID_LENGTH)
    settings: Optional[TraversalSettings] = None


class ExpandRequest(StrictRequestModel):
    paperId: str = Field(min_length=1, max_length=MAX_OPENALEX_ID_LENGTH)
    conceptContext: str = Field(min_length=1, max_length=MAX_CONCEPT_CONTEXT_LENGTH)
    settings: Optional[TraversalSettings] = None


class ChatRequest(StrictRequestModel):
    graphId: Optional[str] = Field(default=None, max_length=MAX_GRAPH_ID_LENGTH)
    userId: Optional[str] = Field(default=None, max_length=MAX_USER_ID_LENGTH)
    paperId: str = Field(min_length=1, max_length=MAX_OPENALEX_ID_LENGTH)
    title: str = Field(min_length=1, max_length=MAX_TITLE_LENGTH)
    year: Optional[int] = None
    summary: str = Field(default="", max_length=MAX_SUMMARY_LENGTH)
    question: str = Field(min_length=1, max_length=MAX_CHAT_QUESTION_LENGTH)
    selectedExcerpt: Optional[str] = Field(default=None, max_length=MAX_SELECTED_EXCERPT_LENGTH)

    @model_validator(mode="after")
    def validate_persistence_context(self):
        if bool(self.graphId) != bool(self.userId):
            raise ValueError("graphId and userId must be supplied together")
        return self


class GraphPaper(BaseModel):
    openalexId: str
    title: str
    year: Optional[int] = None
    summary: str = ""
    detail: str = ""
    authors: list[str] = Field(default_factory=list)
    doi: Optional[str] = None
    oaUrl: Optional[str] = None
    isOa: bool = False
    oaStatus: Optional[str] = None
    hasFulltext: bool = False
    hasContentPdf: bool = False
    hasContentTei: bool = False
    oaLicense: Optional[str] = None
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
    sessionId: Optional[str] = None
    toolUses: list[dict[str, Any]] = Field(default_factory=list)
    citations: list[dict[str, Any]] = Field(default_factory=list)


class PaperAccessResponse(BaseModel):
    openalexId: str
    accessStatus: Literal["available", "unavailable", "failed"]
    ingestionStatus: Literal["ready", "not_cached", "processing", "failed"]
    sourceType: Optional[Literal["openalex_tei", "openalex_pdf", "unpaywall_pdf"]] = None
    license: Optional[str] = None
    requiresConfirmation: bool = False
    message: str


class RetrievePaperRequest(StrictRequestModel):
    userId: str = Field(min_length=1, max_length=MAX_USER_ID_LENGTH)
    confirmed: bool


class RetrievePaperResponse(BaseModel):
    status: Literal["ready", "cached", "processing", "unavailable"]
    documentId: Optional[str] = None
    chunkCount: int = 0
    sourceType: Optional[str] = None
    message: str


class SearchPaperContentRequest(StrictRequestModel):
    userId: str = Field(min_length=1, max_length=MAX_USER_ID_LENGTH)
    query: str = Field(min_length=1, max_length=MAX_CHAT_QUESTION_LENGTH)
    limit: int = Field(default=6, ge=1, le=6)


class PaperChunkCitation(BaseModel):
    id: str
    openalexId: str
    title: str
    section: str
    pageStart: Optional[int] = None
    pageEnd: Optional[int] = None
    chunkIndex: int
    sourceType: str
    sourceUrl: Optional[str] = None


class RetrievedPaperChunk(BaseModel):
    content: str
    citation: PaperChunkCitation
    vectorScore: float
    rerankScore: Optional[float] = None


class SearchPaperContentResponse(BaseModel):
    scope: Literal["paper", "graph"]
    query: str
    matches: list[RetrievedPaperChunk] = Field(default_factory=list)


class PaperContentChunk(BaseModel):
    chunkIndex: int
    content: str
    section: Optional[str] = None
    sectionType: Optional[str] = None
    pageStart: Optional[int] = None
    pageEnd: Optional[int] = None


class PaperContentResponse(BaseModel):
    openalexId: str
    documentId: str
    title: str
    sourceType: str
    sourceUrl: Optional[str] = None
    chunks: list[PaperContentChunk] = Field(default_factory=list, max_length=MAX_PAPER_CONTENT_CHUNKS)
    truncated: bool = False


class PaperSummary(StrictRequestModel):
    openalexId: str = Field(min_length=1, max_length=MAX_OPENALEX_ID_LENGTH)
    title: str = Field(min_length=1, max_length=MAX_TITLE_LENGTH)
    year: Optional[int] = None
    summary: str = Field(default="", max_length=MAX_SUMMARY_LENGTH)


class GlobalChatRequest(StrictRequestModel):
    graphId: Optional[str] = Field(default=None, max_length=MAX_GRAPH_ID_LENGTH)
    userId: Optional[str] = Field(default=None, max_length=MAX_USER_ID_LENGTH)
    papers: list[PaperSummary] = Field(min_length=1, max_length=MAX_TIMELINE_PAPERS)
    question: str = Field(min_length=1, max_length=MAX_CHAT_QUESTION_LENGTH)
    mentionedPaperIds: list[str] = Field(default_factory=list, max_length=MAX_TIMELINE_PAPERS)

    @model_validator(mode="after")
    def validate_persistence_context(self):
        if bool(self.graphId) != bool(self.userId):
            raise ValueError("graphId and userId must be supplied together")
        return self


class GlobalChatResponse(BaseModel):
    text: str
    highlightedPaperIds: list[str] = Field(default_factory=list)
    suggestion: Optional[ChatSuggestion] = None
    sessionId: Optional[str] = None
    toolUses: list[dict[str, Any]] = Field(default_factory=list)
    citations: list[dict[str, Any]] = Field(default_factory=list)
    lineageChanges: list[dict[str, Any]] = Field(default_factory=list)


class ChatSessionRequest(StrictRequestModel):
    userId: str = Field(min_length=1, max_length=MAX_USER_ID_LENGTH)
    scope: Literal["paper", "graph"]
    paperOpenalexId: Optional[str] = Field(default=None, max_length=MAX_OPENALEX_ID_LENGTH)

    @model_validator(mode="after")
    def validate_scope(self):
        if self.scope == "paper" and not self.paperOpenalexId:
            raise ValueError("paperOpenalexId is required for paper scope")
        if self.scope == "graph" and self.paperOpenalexId is not None:
            raise ValueError("paperOpenalexId is not allowed for graph scope")
        return self


class ChatMessageRecord(BaseModel):
    id: str
    role: Literal["user", "assistant"]
    content: str
    toolUses: list[dict[str, Any]] = Field(default_factory=list)
    citations: list[dict[str, Any]] = Field(default_factory=list)
    sequenceNumber: int
    createdAt: str


class ChatSessionResponse(BaseModel):
    sessionId: str
    scope: Literal["paper", "graph"]
    paperOpenalexId: Optional[str] = None
    summary: Optional[str] = None
    messages: list[ChatMessageRecord] = Field(default_factory=list)


class ClarifyRequest(StrictRequestModel):
    query: str = Field(min_length=1, max_length=MAX_QUERY_LENGTH)


class ClarifyResponse(BaseModel):
    needs_clarification: bool
    refined_query: Optional[str] = None
    question: Optional[str] = None
    options: Optional[list[str]] = None


class UserUpsertRequest(StrictRequestModel):
    id: str = Field(min_length=1, max_length=MAX_USER_ID_LENGTH)


class UserRecord(BaseModel):
    id: str
    created_at: str
    last_seen: str


class SavedGraphMetadata(BaseModel):
    title: str = ""
    nodeCount: int = 0
    lastOpenedAt: Optional[str] = None
    appVersion: str = Field(default_factory=lambda: settings.app_version)

    model_config = ConfigDict(extra="forbid")


class SaveGraphRequest(StrictRequestModel):
    userId: str = Field(min_length=1, max_length=MAX_USER_ID_LENGTH)
    query: str = Field(min_length=1, max_length=MAX_QUERY_LENGTH)
    data: dict[str, Any]
    seedPaperId: Optional[str] = Field(default=None, max_length=MAX_OPENALEX_ID_LENGTH)
    metadata: SavedGraphMetadata = Field(default_factory=SavedGraphMetadata)

    @field_validator("data")
    @classmethod
    def validate_data_size(cls, data: dict[str, Any]) -> dict[str, Any]:
        encoded = json.dumps(data, separators=(",", ":"))
        if len(encoded.encode("utf-8")) > MAX_GRAPH_JSON_BYTES:
            raise ValueError("Graph payload is too large.")
        return data

    @field_validator("metadata")
    @classmethod
    def validate_metadata(cls, metadata: SavedGraphMetadata) -> SavedGraphMetadata:
        title = metadata.title.strip()
        if len(title) > MAX_METADATA_TITLE_LENGTH:
            raise ValueError(f"Metadata title must be at most {MAX_METADATA_TITLE_LENGTH} characters.")
        metadata.title = title
        return metadata


class UpdateGraphRequest(StrictRequestModel):
    userId: str = Field(min_length=1, max_length=MAX_USER_ID_LENGTH)
    query: Optional[str] = Field(default=None, max_length=MAX_QUERY_LENGTH)
    data: Optional[dict[str, Any]] = None
    seedPaperId: Optional[str] = Field(default=None, max_length=MAX_OPENALEX_ID_LENGTH)
    metadata: Optional[SavedGraphMetadata] = None

    @field_validator("data")
    @classmethod
    def validate_optional_data_size(cls, data: Optional[dict[str, Any]]) -> Optional[dict[str, Any]]:
        if data is None:
            return None
        encoded = json.dumps(data, separators=(",", ":"))
        if len(encoded.encode("utf-8")) > MAX_GRAPH_JSON_BYTES:
            raise ValueError("Graph payload is too large.")
        return data

    @field_validator("query", "seedPaperId")
    @classmethod
    def normalize_optional_text(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        stripped = value.strip()
        if not stripped:
            return None
        return stripped

    @field_validator("metadata")
    @classmethod
    def validate_optional_metadata(cls, metadata: Optional[SavedGraphMetadata]) -> Optional[SavedGraphMetadata]:
        if metadata is None:
            return None
        title = metadata.title.strip()
        if len(title) > MAX_METADATA_TITLE_LENGTH:
            raise ValueError(f"Metadata title must be at most {MAX_METADATA_TITLE_LENGTH} characters.")
        metadata.title = title
        return metadata

    @model_validator(mode="after")
    def ensure_update_has_fields(self) -> "UpdateGraphRequest":
        if self.query is None and self.data is None and self.seedPaperId is None and self.metadata is None:
            raise ValueError("At least one graph field must be provided.")
        return self


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


class GraphListResponse(BaseModel):
    items: list[GraphListItem]
    nextOffset: Optional[int] = None
    hasMore: bool = False


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
