export interface GraphPaper {
  openalexId: string;
  title: string;
  year: number | null;
  summary: string;
  detail?: string;
  authors?: string[];
  doi?: string | null;
  oaUrl?: string | null;
  isOa?: boolean;
  oaStatus?: string | null;
  hasFulltext?: boolean;
  hasContentPdf?: boolean;
  hasContentTei?: boolean;
  oaLicense?: string | null;
  concepts?: string[];
  type?: string | null;
  citedByCount?: number;
  referencesCount?: number;
}

export interface GraphEdge {
  parentOpenalexId: string;
  childOpenalexId: string;
  relation: "influenced" | "inferred";
}

export type NodeBorderColor = "accent" | "blue" | "green" | "purple" | "amber" | "rose";

export interface TimelineNodeAnnotation {
  borderColor?: NodeBorderColor;
}

export type TimelineGraphAction =
  | {
      type: "highlight_node";
      nodeId: number;
      borderColor: NodeBorderColor | null;
    }
  | {
      type: "delete_node";
      nodeId: number;
    };

export interface SeedCandidate {
  openalexId: string;
  title: string;
  year: number | null;
  reason?: string | null;
}

export interface ChatSuggestion {
  topic: string;
  query: string;
  nodeCount: number;
}

export interface PaperChatResponse {
  text: string;
  suggestion?: ChatSuggestion | null;
  sessionId?: string | null;
  toolUses?: Record<string, unknown>[];
  citations?: Record<string, unknown>[];
}

export type PaperChatStreamEvent =
  | { type: "message_started"; paperId?: string }
  | { type: "status"; message: string }
  | { type: "tool_started"; name: string; input?: Record<string, unknown> }
  | { type: "tool_completed"; name: string; status?: string; result?: Record<string, unknown> }
  | { type: "text_delta"; text: string }
  | { type: "citations"; citations: Record<string, unknown>[] }
  | { type: "message_completed"; response: PaperChatResponse }
  | { type: "error"; detail: string; statusCode?: number };

export interface GlobalChatResponse {
  text: string;
  highlightedPaperIds: string[];
  suggestion: ChatSuggestion | null;
  sessionId?: string | null;
}

export interface PersistentChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolUses: Record<string, unknown>[];
  citations: Record<string, unknown>[];
  sequenceNumber: number;
  createdAt: string;
}

export interface PersistentChatSession {
  sessionId: string;
  scope: "paper" | "graph";
  paperOpenalexId?: string | null;
  summary?: string | null;
  messages: PersistentChatMessage[];
}

export interface TraversalSettings {
  depth: number;
  breadth: number;
  referenceLimit: number;
  topN: number;
}

export interface SearchMeta {
  query: string;
  mode: "resolved" | "resolved_inferred" | "needs_disambiguation";
  confidence?: "high" | "medium" | "low" | null;
  cacheHit: boolean;
}

export interface LineageGraphResponse {
  seedPaperId: string | null;
  papers: GraphPaper[];
  edges: GraphEdge[];
  rootIds: string[];
  meta: SearchMeta;
  disambiguation?: SeedCandidate[] | null;
}

export interface Paper {
  id: number;
  openalexId: string;
  title: string;
  year: number;
  summary: string;
  detail?: string;
  authors?: string[];
  doi?: string | null;
  oaUrl?: string | null;
  isOa?: boolean;
  oaStatus?: string | null;
  hasFulltext?: boolean;
  hasContentPdf?: boolean;
  hasContentTei?: boolean;
  oaLicense?: string | null;
  concepts?: string[];
  type?: string | null;
  arxivId?: string;
  citedByCount?: number;
  referencesCount?: number;
}

export interface TimelineNode {
  id: number;
  paper: Paper;
  x: number;
  y: number;
  lane: number;
  parentId: number | null;
  expanded: boolean;
  generation: number;
  annotation?: TimelineNodeAnnotation;
}

export interface TimelineData {
  nodes: Record<number, TimelineNode>;
  adjacency: Record<number, number[]>;
  edgeRelations?: Record<string, GraphEdge["relation"]>;
  lanes: number;
  rootId: number;
  expansions: Expansion[];
}

export interface PaperAccessResponse {
  openalexId: string;
  accessStatus: "available" | "unavailable" | "failed";
  ingestionStatus: "ready" | "not_cached" | "failed";
  sourceType: "openalex_tei" | "openalex_pdf" | "unpaywall_pdf" | null;
  license: string | null;
  requiresConfirmation: boolean;
  message: string;
}

export interface Expansion {
  sourceNodeId: number;
  query: string;
  lane: number;
}

export interface SavedGraphMetadata {
  title: string;
  nodeCount: number;
  lastOpenedAt?: string | null;
  appVersion: string;
}

export interface SavedGraph {
  id: string;
  userId: string;
  query: string;
  data: TimelineData;
  metadata: SavedGraphMetadata;
  seedPaperId?: string | null;
  isPublic: boolean;
  shareId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SavedGraphListItem {
  id: string;
  query: string;
  seedPaperId?: string | null;
  metadata: SavedGraphMetadata;
  createdAt: string;
  updatedAt: string;
}

export interface SavedGraphListResponse {
  items: SavedGraphListItem[];
  nextOffset?: number | null;
  hasMore: boolean;
}
