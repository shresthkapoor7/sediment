import {
  ChatSuggestion,
  GlobalChatResponse,
  LineageGraphResponse,
  SavedGraph,
  SavedGraphListItem,
  SavedGraphMetadata,
  TimelineData,
  TimelineNode,
  TraversalSettings,
} from "./types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
export const SEDIMENT_USER_ID_KEY = "sediment_user_id";
export const LAST_GRAPH_ID_KEY = "last_graph_id";
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || "0.1.0";

export class APIError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "APIError";
    this.status = status;
  }
}

export async function searchLineage(
  query: string,
  seedOpenalexId?: string,
  settings?: TraversalSettings,
): Promise<LineageGraphResponse> {
  const response = await fetch(`${API_BASE}/api/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query,
      ...(seedOpenalexId ? { seedOpenalexId } : {}),
      ...(settings ? { settings } : {}),
    }),
  });

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new APIError(detail || `Search failed with status ${response.status}`, response.status);
  }

  return response.json();
}

export async function expandLineage(
  paperId: string,
  conceptContext: string,
  settings?: TraversalSettings,
): Promise<LineageGraphResponse> {
  const response = await fetch(`${API_BASE}/api/expand`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paperId, conceptContext, ...(settings ? { settings } : {}) }),
  });

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new APIError(detail || `Expand failed with status ${response.status}`, response.status);
  }

  return response.json();
}

export async function chatAboutPaper(node: TimelineNode, question: string): Promise<{ text: string; suggestion?: ChatSuggestion | null }> {
  const response = await fetch(`${API_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      paperId: node.paper.openalexId,
      title: node.paper.title,
      year: node.paper.year,
      summary: node.paper.summary,
      authors: node.paper.authors ?? [],
      question,
    }),
  });

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new APIError(detail || `Chat failed with status ${response.status}`, response.status);
  }

  return response.json();
}

export async function suggestTimelineQuestions(
  papers: { openalexId: string; title: string; year?: number | null; summary?: string }[],
): Promise<string[]> {
  const response = await fetch(`${API_BASE}/api/chat/global/suggestions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(papers),
  });
  if (!response.ok) return [];
  return response.json();
}

export async function chatAboutTimeline(
  papers: { openalexId: string; title: string; year?: number | null; summary?: string }[],
  question: string,
): Promise<GlobalChatResponse> {
  const response = await fetch(`${API_BASE}/api/chat/global`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ papers, question }),
  });

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new APIError(detail || `Chat failed with status ${response.status}`, response.status);
  }

  return response.json();
}

export function getOrCreateAnonymousUserId(): string {
  const existing = window.localStorage.getItem(SEDIMENT_USER_ID_KEY);
  if (existing) return existing;

  const userId = crypto.randomUUID();
  window.localStorage.setItem(SEDIMENT_USER_ID_KEY, userId);
  return userId;
}

export async function registerAnonymousUser(userId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/api/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: userId }),
  });

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new APIError(detail || `User registration failed with status ${response.status}`, response.status);
  }
}

export async function createSavedGraph(input: {
  userId: string;
  query: string;
  data: TimelineData;
  seedPaperId?: string | null;
  metadata: SavedGraphMetadata;
}): Promise<SavedGraph> {
  const response = await fetch(`${API_BASE}/api/graphs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new APIError(detail || `Save failed with status ${response.status}`, response.status);
  }

  return response.json();
}

export async function updateSavedGraph(
  graphId: string,
  input: {
    userId: string;
    query?: string;
    data?: TimelineData;
    seedPaperId?: string | null;
    metadata?: SavedGraphMetadata;
  },
): Promise<SavedGraph> {
  const response = await fetch(`${API_BASE}/api/graphs/${graphId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new APIError(detail || `Update failed with status ${response.status}`, response.status);
  }

  return response.json();
}

export async function fetchSavedGraph(graphId: string, userId: string): Promise<SavedGraph> {
  const response = await fetch(`${API_BASE}/api/graphs/${graphId}?userId=${encodeURIComponent(userId)}`);

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new APIError(detail || `Load failed with status ${response.status}`, response.status);
  }

  return response.json();
}

export async function listSavedGraphs(userId: string): Promise<SavedGraphListItem[]> {
  const response = await fetch(`${API_BASE}/api/graphs?userId=${encodeURIComponent(userId)}`);

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new APIError(detail || `List failed with status ${response.status}`, response.status);
  }

  return response.json();
}

export async function shareGraph(graphId: string, userId: string): Promise<{ shareId: string; shareUrl: string }> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || window.location.origin;
  const response = await fetch(
    `${API_BASE}/api/graphs/${graphId}/share?userId=${encodeURIComponent(userId)}`,
    { method: "POST" },
  );

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new APIError(detail || `Share failed with status ${response.status}`, response.status);
  }

  const data = await response.json();
  return {
    shareId: data.shareId,
    shareUrl: `${appUrl}/s/${data.shareId}`,
  };
}

export async function fetchSharedGraph(shareId: string): Promise<SavedGraph> {
  const response = await fetch(`${API_BASE}/api/share/${shareId}`);

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new APIError(detail || `Load failed with status ${response.status}`, response.status);
  }

  return response.json();
}

async function readErrorDetail(response: Response): Promise<string> {
  try {
    const data = await response.json();
    if (typeof data?.detail === "string") {
      return data.detail;
    }
  } catch {
    // ignore parse errors
  }
  return "";
}
