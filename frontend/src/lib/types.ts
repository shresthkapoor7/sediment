// Wire format the LLM returns — no IDs, parentIndex is 0-based index into the returned array
export interface LLMPaper {
  title: string;
  year: number;
  summary: string;
  detail?: string;
  authors?: string[];
  arxivId?: string;
  parentIndex: number | null; // null = root of this lineage
}

export interface Paper {
  id: number;
  title: string;
  year: number;
  summary: string;
  detail?: string;
  authors?: string[];
  arxivId?: string;
}

export interface TimelineNode {
  id: number;             // auto-assigned by frontend, never from LLM
  paper: Paper;
  x: number;
  y: number;
  lane: number;
  parentId: number | null; // O(1) parent lookup; null if root
  expanded: boolean;
  generation: number;
}

export interface TimelineData {
  nodes: Record<number, TimelineNode>;
  adjacency: Record<number, number[]>; // single source of truth: nodeId → childIds
  lanes: number;
  rootId: number;
  expansions: Expansion[];
}

export interface Expansion {
  sourceNodeId: number;
  query: string;
  lane: number;
}
