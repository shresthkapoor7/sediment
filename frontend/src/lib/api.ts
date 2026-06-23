import {
  GlobalChatResponse,
  LineageGraphResponse,
  PaperChatResponse,
  PaperChatStreamEvent,
  PaperAccessResponse,
  PersistentChatSession,
  SavedGraph,
  SavedGraphListItem,
  SavedGraphMetadata,
  TimelineData,
  TimelineNode,
  TraversalSettings,
} from "./types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
const USE_API_PROXY = process.env.NEXT_PUBLIC_USE_API_PROXY === "true";
const PROXY_API_BASE = "";
const EXPENSIVE_API_BASE = USE_API_PROXY ? PROXY_API_BASE : API_BASE;
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
  const response = await fetch(`${EXPENSIVE_API_BASE}/api/search`, {
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

export interface ClarifyResult {
  needsClarification: boolean;
  refinedQuery?: string;
  question?: string;
  options?: string[];
}

export async function clarifyQuery(query: string): Promise<ClarifyResult> {
  const response = await fetch(`${EXPENSIVE_API_BASE}/api/clarify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });

  if (!response.ok) {
    if (response.status === 429) {
      const detail = await readErrorDetail(response);
      throw new APIError(detail || "Clarification rate limited", response.status);
    }
    return { needsClarification: false, refinedQuery: query };
  }

  const data = await response.json();
  const payload = data && typeof data === "object" && !Array.isArray(data)
    ? data as Record<string, unknown>
    : {};
  const rawNeedsClarification = payload.needs_clarification;
  const needsClarification = typeof rawNeedsClarification === "boolean"
    ? rawNeedsClarification
    : typeof rawNeedsClarification === "string"
      ? ["true", "1", "yes"].includes(rawNeedsClarification.trim().toLowerCase())
      : typeof rawNeedsClarification === "number"
        ? rawNeedsClarification === 1
        : false;
  const refinedQuery = typeof payload.refined_query === "string" && payload.refined_query.trim()
    ? payload.refined_query
    : query;
  const question = typeof payload.question === "string" ? payload.question : "";
  const options = Array.isArray(payload.options)
    ? payload.options.filter((option): option is string => typeof option === "string")
    : [];
  return {
    needsClarification,
    refinedQuery,
    question,
    options,
  };
}

export async function expandLineage(
  paperId: string,
  conceptContext: string,
  settings?: TraversalSettings,
): Promise<LineageGraphResponse> {
  const response = await fetch(`${EXPENSIVE_API_BASE}/api/expand`, {
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

export async function chatAboutPaper(
  node: TimelineNode,
  question: string,
  persistence?: { graphId: string; userId: string },
): Promise<PaperChatResponse> {
  const response = await fetch(`${EXPENSIVE_API_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...(persistence ?? {}),
      paperId: node.paper.openalexId,
      title: node.paper.title,
      year: node.paper.year,
      summary: node.paper.summary,
      question,
    }),
  });

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new APIError(detail || `Chat failed with status ${response.status}`, response.status);
  }

  return response.json();
}

export async function streamChatAboutPaper(
  node: TimelineNode,
  question: string,
  onEvent: (event: PaperChatStreamEvent) => void,
  persistence?: { graphId: string; userId: string },
): Promise<PaperChatResponse | null> {
  const response = await fetch(`${EXPENSIVE_API_BASE}/api/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({
      ...(persistence ?? {}),
      paperId: node.paper.openalexId,
      title: node.paper.title,
      year: node.paper.year,
      summary: node.paper.summary,
      question,
    }),
  });

  if (!response.ok || !response.body) {
    const detail = await readErrorDetail(response);
    throw new APIError(detail || `Chat stream failed with status ${response.status}`, response.status);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalResponse: PaperChatResponse | null = null;

  function consume(rawEvent: string) {
    const lines = rawEvent.split(/\r?\n/);
    const eventType = lines.find((line) => line.startsWith("event: "))?.slice(7).trim();
    const dataLines = lines
      .filter((line) => line.startsWith("data: "))
      .map((line) => line.slice(6));
    if (!eventType || dataLines.length === 0) return;
    const payload = JSON.parse(dataLines.join("\n")) as Record<string, unknown>;
    const event = { type: eventType, ...payload } as PaperChatStreamEvent;
    onEvent(event);
    if (event.type === "message_completed") finalResponse = event.response;
    if (event.type === "error") throw new APIError(event.detail, event.statusCode ?? 500);
  }

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const parts = buffer.split(/\n\n/);
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      if (part.trim()) consume(part);
    }
    if (done) break;
  }
  if (buffer.trim()) consume(buffer);

  return finalResponse;
}

export async function fetchPaperAccess(openalexId: string): Promise<PaperAccessResponse> {
  const response = await fetch(
    `${EXPENSIVE_API_BASE}/api/papers/${encodeURIComponent(openalexId)}/access`,
    { cache: "no-store" },
  );
  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new APIError(detail || `Access check failed with status ${response.status}`, response.status);
  }
  return response.json();
}

export async function suggestTimelineQuestions(
  papers: { openalexId: string; title: string; year?: number | null; summary?: string }[],
): Promise<string[]> {
  const response = await fetch(`${EXPENSIVE_API_BASE}/api/chat/global/suggestions`, {
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
  persistence?: { graphId: string; userId: string },
): Promise<GlobalChatResponse> {
  const response = await fetch(`${EXPENSIVE_API_BASE}/api/chat/global`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...(persistence ?? {}), papers, question }),
  });

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new APIError(detail || `Chat failed with status ${response.status}`, response.status);
  }

  return response.json();
}

export async function openChatSession(
  graphId: string,
  userId: string,
  scope: "paper" | "graph",
  paperOpenalexId?: string,
): Promise<PersistentChatSession> {
  const response = await fetch(`${API_BASE}/api/graphs/${encodeURIComponent(graphId)}/chat/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId,
      scope,
      ...(paperOpenalexId ? { paperOpenalexId } : {}),
    }),
    cache: "no-store",
  });
  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new APIError(detail || `Chat history failed with status ${response.status}`, response.status);
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

export async function deleteSavedGraph(graphId: string, userId: string): Promise<void> {
  const response = await fetch(
    `${API_BASE}/api/graphs/${encodeURIComponent(graphId)}?userId=${encodeURIComponent(userId)}`,
    { method: "DELETE" },
  );

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new APIError(detail || `Delete failed with status ${response.status}`, response.status);
  }
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
  const shareUrl = data.shareUrl?.startsWith("/")
    ? `${appUrl}${data.shareUrl}`
    : data.shareUrl || `${appUrl}/s/${data.shareId}`;
  return { shareId: data.shareId, shareUrl };
}

export async function fetchSharedGraph(shareId: string): Promise<SavedGraph> {
  const response = await fetch(`${API_BASE}/api/share/${shareId}`);

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new APIError(detail || `Load failed with status ${response.status}`, response.status);
  }

  return response.json();
}

export async function fetchUsage(): Promise<{ used: number; remaining: number; segments: number; requestCount: number; dailyLimit: number }> {
  const response = await fetch(`${EXPENSIVE_API_BASE}/api/usage`, {
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new APIError(detail || `Usage failed with status ${response.status}`, response.status);
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
