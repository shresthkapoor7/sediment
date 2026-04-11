export interface GraphPaper {
  openalexId: string;
  title: string;
  year: number | null;
  summary: string;
  detail?: string;
  authors?: string[];
  doi?: string | null;
}

export interface GraphEdge {
  parentOpenalexId: string;
  childOpenalexId: string;
  relation: "influenced";
}

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

export interface GlobalChatResponse {
  text: string;
  highlightedPaperIds: string[];
  suggestion: ChatSuggestion | null;
}

export interface TraversalSettings {
  depth: number;
  breadth: number;
  referenceLimit: number;
  topN: number;
}

export interface SearchMeta {
  query: string;
  mode: "resolved" | "needs_disambiguation";
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
  arxivId?: string;
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
}

export interface TimelineData {
  nodes: Record<number, TimelineNode>;
  adjacency: Record<number, number[]>;
  lanes: number;
  rootId: number;
  expansions: Expansion[];
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
