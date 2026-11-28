import type { CanvasOp, CanvasOpSource } from "./canvas-ops";
import {
  CanvasDetails,
  GlobalChatResponse,
  GlobalChatStreamEvent,
  GraphPaper,
  PaperChatResponse,
  PaperChatStreamEvent,
  PaperAccessResponse,
  PaperContentResponse,
  PersistentChatSession,
  SavedGraph,
  SavedGraphListItem,
  SavedGraphListResponse,
  SavedGraphMetadata,
  SpecialNoteFile,
  SpecialNoteFileListResponse,
  TimelineData,
  TimelineNode,
  TimelineNodeColorChange,
  TimelineNoteContext,
} from "./types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
const USE_API_PROXY = process.env.NEXT_PUBLIC_USE_API_PROXY === "true";
const PROXY_API_BASE = "";
const EXPENSIVE_API_BASE = USE_API_PROXY ? PROXY_API_BASE : API_BASE;
export const SEDIMENT_USER_ID_KEY = "sediment_user_id";

/** The anonymous user ID unlocks every canvas made in this browser, so it travels in a header, never in a URL
 *  where access logs and browser history would keep it. */
export const USER_ID_HEADER = "X-Sediment-User";

// Set by the auth layer whenever Supabase signs in, refreshes or signs out. Only the short-lived access token
// is kept here; supabase-js holds the refresh token and rotates it.
let accessToken: string | null = null;
export function setAccessToken(token: string | null): void { accessToken = token; }
export const isSignedIn = (): boolean => accessToken !== null;

// Requests wait for the stored session to be read, so the first calls on a page load go out as the account rather
// than silently as the anonymous browser. AuthProvider always resolves this, also when reading the session fails.
let resolveSessionReady: () => void = () => {};
const sessionReady = new Promise<void>((resolve) => { resolveSessionReady = resolve; });
export function markSessionReady(): void { resolveSessionReady(); }

/** fetch with the caller's identity attached at send time (after the session is known). */
async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  if (typeof window !== "undefined") {
    await sessionReady;
  }
  const headers = new Headers(init.headers);
  headers.delete("Authorization");
  for (const [name, value] of Object.entries(identityHeaders())) headers.set(name, value);
  return fetch(input, { ...init, headers });
}
export { apiFetch };

/** Who is calling: the account token when signed in, and always the browser ID (the backend uses it when
 *  there is no token, and the anonymous-to-account move needs it). */
export function identityHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  if (typeof window !== "undefined") headers[USER_ID_HEADER] = getOrCreateAnonymousUserId();
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return headers;
}
export const LAST_GRAPH_ID_KEY = "last_graph_id";
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || "0.1.0";
export const SPECIAL_NOTE_SIGNED_URL_TTL_MS = 5 * 60 * 1000;

export class APIError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "APIError";
    this.status = status;
  }
}

export async function chatAboutPaper(
  node: TimelineNode,
  question: string,
  persistence?: { graphId: string; userId: string },
): Promise<PaperChatResponse> {
  const response = await apiFetch(`${EXPENSIVE_API_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...identityHeaders() },
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
  selectedExcerpt?: string,
): Promise<PaperChatResponse | null> {
  const response = await apiFetch(`${EXPENSIVE_API_BASE}/api/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream", ...identityHeaders() },
    body: JSON.stringify({
      ...(persistence ?? {}),
      paperId: node.paper.openalexId,
      title: node.paper.title,
      year: node.paper.year,
      summary: node.paper.summary,
      question,
      ...(selectedExcerpt ? { selectedExcerpt } : {}),
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
    const parts = buffer.split(/\r?\n\r?\n/);
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      if (part.trim()) consume(part);
    }
    if (done) break;
  }
  if (buffer.trim()) consume(buffer);

  return finalResponse;
}

/** Plain OpenAlex lookup: free text (keyword, or by meaning), or a pasted DOI, arXiv link or OpenAlex ID. No model call. */
export async function searchPapers(
  query: string,
  signal?: AbortSignal,
  mode: "keyword" | "semantic" = "keyword",
): Promise<GraphPaper[]> {
  const response = await apiFetch(
    `${EXPENSIVE_API_BASE}/api/papers/search?q=${encodeURIComponent(query)}&mode=${mode}`,
    { cache: "no-store", signal, headers: identityHeaders() },
  );
  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new APIError(detail || `Paper search failed with status ${response.status}`, response.status);
  }
  return response.json();
}

export async function fetchPaperAccess(openalexId: string): Promise<PaperAccessResponse> {
  const response = await apiFetch(
    `${EXPENSIVE_API_BASE}/api/papers/${encodeURIComponent(openalexId)}/access`,
    { cache: "no-store", headers: identityHeaders() },
  );
  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new APIError(detail || `Access check failed with status ${response.status}`, response.status);
  }
  return response.json();
}

export async function fetchCachedPaperContent(
  graphId: string,
  userId: string,
  openalexId: string,
): Promise<PaperContentResponse> {
  const response = await apiFetch(
    `${EXPENSIVE_API_BASE}/api/graphs/${encodeURIComponent(graphId)}/papers/${encodeURIComponent(openalexId)}/content`,
    { cache: "no-store", headers: identityHeaders() },
  );
  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new APIError(detail || `Paper content failed with status ${response.status}`, response.status);
  }
  return response.json();
}

export async function suggestTimelineQuestions(
  papers: { openalexId: string; title: string; year?: number | null; summary?: string }[],
): Promise<string[]> {
  const response = await apiFetch(`${EXPENSIVE_API_BASE}/api/chat/global/suggestions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...identityHeaders() },
    body: JSON.stringify(papers),
  });
  if (!response.ok) return [];
  return response.json();
}

export async function chatAboutTimeline(
  papers: { openalexId: string; title: string; year?: number | null; summary?: string }[],
  question: string,
  persistence?: { graphId: string; userId: string },
  mentionedPaperIds: string[] = [],
  noteContext?: TimelineNoteContext,
  nodeColorContext?: TimelineNodeColorChange[],
): Promise<GlobalChatResponse> {
  const response = await apiFetch(`${EXPENSIVE_API_BASE}/api/chat/global`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...identityHeaders() },
    body: JSON.stringify({ ...(persistence ?? {}), papers, question, mentionedPaperIds, ...(noteContext ? { noteContext } : {}), ...(nodeColorContext ? { nodeColorContext } : {}) }),
  });

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new APIError(detail || `Chat failed with status ${response.status}`, response.status);
  }

  return response.json();
}

export async function streamChatAboutTimeline(
  papers: { openalexId: string; title: string; year?: number | null; summary?: string; group?: string }[],
  question: string,
  onEvent: (event: GlobalChatStreamEvent) => void,
  persistence?: { graphId: string; userId: string; sessionId?: string },
  mentionedPaperIds: string[] = [],
  noteContext?: TimelineNoteContext,
  nodeColorContext?: TimelineNodeColorChange[],
  edges?: { parentPaperId: string; childPaperId: string }[],
  canvas?: CanvasDetails,
): Promise<GlobalChatResponse | null> {
  const response = await apiFetch(`${EXPENSIVE_API_BASE}/api/chat/global/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream", ...identityHeaders() },
    body: JSON.stringify({ ...(persistence ?? {}), papers, ...(edges ? { edges } : {}), question, mentionedPaperIds, ...(noteContext ? { noteContext } : {}), ...(nodeColorContext ? { nodeColorContext } : {}), ...(canvas ? { canvas } : {}) }),
  });

  if (!response.ok || !response.body) {
    const detail = await readErrorDetail(response);
    throw new APIError(detail || `Chat stream failed with status ${response.status}`, response.status);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalResponse: GlobalChatResponse | null = null;

  function consume(rawEvent: string) {
    const lines = rawEvent.split(/\r?\n/);
    const eventType = lines.find((line) => line.startsWith("event: "))?.slice(7).trim();
    const dataLines = lines
      .filter((line) => line.startsWith("data: "))
      .map((line) => line.slice(6));
    if (!eventType || dataLines.length === 0) return;
    const payload = JSON.parse(dataLines.join("\n")) as Record<string, unknown>;
    const event = { type: eventType, ...payload } as GlobalChatStreamEvent;
    onEvent(event);
    if (event.type === "message_completed") finalResponse = event.response;
    if (event.type === "error") throw new APIError(event.detail, event.statusCode ?? 500);
  }

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const parts = buffer.split(/\r?\n\r?\n/);
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      if (part.trim()) consume(part);
    }
    if (done) break;
  }
  if (buffer.trim()) consume(buffer);

  return finalResponse;
}

export async function openChatSession(
  graphId: string,
  userId: string,
  scope: "paper" | "graph",
  paperOpenalexId?: string,
  sessionId?: string,
): Promise<PersistentChatSession> {
  const response = await apiFetch(`${API_BASE}/api/graphs/${encodeURIComponent(graphId)}/chat/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...identityHeaders() },
    body: JSON.stringify({
      userId,
      scope,
      ...(paperOpenalexId ? { paperOpenalexId } : {}),
      ...(sessionId ? { sessionId } : {}),
    }),
    cache: "no-store",
  });
  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new APIError(detail || `Chat history failed with status ${response.status}`, response.status);
  }
  return response.json();
}

export interface ChatTab {
  sessionId: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

/** The agent chats on a canvas, oldest first. A canvas always has at least one. */
export async function listChats(graphId: string, userId: string): Promise<ChatTab[]> {
  const response = await apiFetch(
    `${API_BASE}/api/graphs/${encodeURIComponent(graphId)}/chats`,
    { cache: "no-store", headers: identityHeaders() },
  );
  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new APIError(detail || `Chats failed with status ${response.status}`, response.status);
  }
  return response.json();
}

export async function createChat(graphId: string, userId: string): Promise<ChatTab> {
  const response = await apiFetch(`${API_BASE}/api/graphs/${encodeURIComponent(graphId)}/chats`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...identityHeaders() },
    body: JSON.stringify({ userId }),
  });
  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new APIError(detail || `New chat failed with status ${response.status}`, response.status);
  }
  return response.json();
}

export async function deleteChat(graphId: string, userId: string, sessionId: string): Promise<void> {
  const response = await apiFetch(
    `${API_BASE}/api/graphs/${encodeURIComponent(graphId)}/chats/${encodeURIComponent(sessionId)}`,
    { method: "DELETE", headers: identityHeaders() },
  );
  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new APIError(detail || `Close chat failed with status ${response.status}`, response.status);
  }
}

let memoryAnonymousUserId: string | null = null;

export function getOrCreateAnonymousUserId(): string {
  if (memoryAnonymousUserId) return memoryAnonymousUserId;
  try {
    const existing = window.localStorage.getItem(SEDIMENT_USER_ID_KEY);
    if (existing) return (memoryAnonymousUserId = existing);
  } catch { /* Restricted browser storage: retain an ID for this page session. */ }
  memoryAnonymousUserId = crypto.randomUUID();
  try { window.localStorage.setItem(SEDIMENT_USER_ID_KEY, memoryAnonymousUserId); }
  catch { /* The in-memory ID remains stable until the page is reloaded. */ }
  return memoryAnonymousUserId;
}

export interface ClaimResult { status: string; graphs?: number; sessions?: number; files?: number }

/** Moves this browser's anonymous canvases, chats and note files onto the signed-in account (safe to repeat). */
export async function claimAnonymousWork(): Promise<ClaimResult> {
  const response = await apiFetch(`${API_BASE}/api/account/claim`, {
    method: "POST",
    headers: { ...identityHeaders(), [USER_ID_HEADER]: getOrCreateAnonymousUserId() },
  });
  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new APIError(detail || `Claim failed with status ${response.status}`, response.status);
  }
  return response.json();
}

/** The signed-in account's Workspaces categories; `null` when it has never saved any. */
export async function fetchWorkspaceLayout(): Promise<unknown[] | null> {
  const response = await apiFetch(`${API_BASE}/api/account/workspaces`, { headers: identityHeaders() });
  if (!response.ok) throw new APIError(`Loading workspaces failed with status ${response.status}`, response.status);
  return (await response.json()).categories ?? null;
}

export async function saveWorkspaceLayout(categories: unknown[]): Promise<void> {
  const response = await apiFetch(`${API_BASE}/api/account/workspaces`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...identityHeaders() },
    body: JSON.stringify({ categories }),
  });
  if (!response.ok) throw new APIError(`Saving workspaces failed with status ${response.status}`, response.status);
}

export async function registerAnonymousUser(userId: string): Promise<void> {
  const response = await apiFetch(`${API_BASE}/api/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...identityHeaders() },
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
  const response = await apiFetch(`${API_BASE}/api/graphs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...identityHeaders() },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new APIError(detail || `Save failed with status ${response.status}`, response.status);
  }

  return response.json();
}

export interface CanvasOpsResult { version: number; data: TimelineData; changed: boolean }

/** Sends canvas operations to the Next.js ops route, which applies them on the server and logs who made them. */
export async function postCanvasOps(graphId: string, ops: CanvasOp[], via: CanvasOpSource, batchId: string): Promise<CanvasOpsResult> {
  const response = await apiFetch(`/api/graphs/${encodeURIComponent(graphId)}/ops`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...identityHeaders() },
    body: JSON.stringify({ ops, via, batchId }),
  });
  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new APIError(detail || `Saving the canvas failed with status ${response.status}`, response.status);
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
  const response = await apiFetch(`${API_BASE}/api/graphs/${graphId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...identityHeaders() },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new APIError(detail || `Update failed with status ${response.status}`, response.status);
  }

  return response.json();
}

export async function fetchSavedGraph(graphId: string, userId: string): Promise<SavedGraph> {
  const response = await apiFetch(`${API_BASE}/api/graphs/${encodeURIComponent(graphId)}`, { headers: identityHeaders() });

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new APIError(detail || `Load failed with status ${response.status}`, response.status);
  }

  return response.json();
}

export async function listSavedGraphs(
  userId: string,
  options: { limit?: number; offset?: number } = {},
): Promise<SavedGraphListResponse> {
  const params = new URLSearchParams({
    limit: String(options.limit ?? 10),
    offset: String(options.offset ?? 0),
  });
  const response = await apiFetch(`${API_BASE}/api/graphs?${params.toString()}`, { headers: identityHeaders() });

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new APIError(detail || `List failed with status ${response.status}`, response.status);
  }

  const payload = await response.json();
  if (Array.isArray(payload)) {
    return { items: payload as SavedGraphListItem[], hasMore: false, nextOffset: null };
  }
  return payload;
}

export async function deleteSavedGraph(graphId: string, userId: string): Promise<void> {
  const response = await apiFetch(
    `${API_BASE}/api/graphs/${encodeURIComponent(graphId)}`,
    { method: "DELETE", headers: identityHeaders() },
  );

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new APIError(detail || `Delete failed with status ${response.status}`, response.status);
  }
}

export async function listSpecialNoteFiles(
  graphId: string,
  userId: string,
): Promise<SpecialNoteFileListResponse> {
  const response = await apiFetch(
    `${API_BASE}/api/graphs/${encodeURIComponent(graphId)}/special-notes`,
    { cache: "no-store", headers: identityHeaders() },
  );
  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new APIError(detail || `Special note load failed with status ${response.status}`, response.status);
  }
  return response.json();
}

export async function uploadSpecialNoteFile(
  graphId: string,
  userId: string,
  file: File,
): Promise<SpecialNoteFile> {
  const form = new FormData();
  form.append("userId", userId);
  form.append("file", file, file.name);
  const response = await apiFetch(`${API_BASE}/api/graphs/${encodeURIComponent(graphId)}/special-notes`, {
    method: "POST",
    headers: identityHeaders(),
    body: form,
  });
  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new APIError(detail || `Special note upload failed with status ${response.status}`, response.status);
  }
  return response.json();
}

export async function fetchSpecialNoteFileUrl(
  graphId: string,
  userId: string,
  fileId: string,
): Promise<string> {
  const response = await apiFetch(
    `${API_BASE}/api/graphs/${encodeURIComponent(graphId)}/special-notes/${encodeURIComponent(fileId)}/url`,
    { cache: "no-store", headers: identityHeaders() },
  );
  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new APIError(detail || `Special note open failed with status ${response.status}`, response.status);
  }
  const payload: unknown = await response.json();
  const url = payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as { url?: unknown }).url
    : undefined;
  if (typeof url !== "string" || !url) {
    throw new APIError("Special note open response was invalid.", response.status);
  }
  return url;
}

export async function deleteSpecialNoteFile(
  graphId: string,
  userId: string,
  fileId: string,
): Promise<void> {
  const response = await apiFetch(
    `${API_BASE}/api/graphs/${encodeURIComponent(graphId)}/special-notes/${encodeURIComponent(fileId)}`,
    { method: "DELETE", headers: identityHeaders() },
  );
  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new APIError(detail || `Special note deletion failed with status ${response.status}`, response.status);
  }
}

export async function shareGraph(graphId: string, userId: string): Promise<{ shareId: string; shareUrl: string }> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || window.location.origin;
  const response = await apiFetch(
    `${API_BASE}/api/graphs/${graphId}/share`,
    { method: "POST", headers: identityHeaders() },
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
  const response = await apiFetch(`${API_BASE}/api/share/${shareId}`);

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new APIError(detail || `Load failed with status ${response.status}`, response.status);
  }

  return response.json();
}

// The last usage meter value this tab loaded, so a page can show the meter at once instead of waiting for
// its own request. Starts full, like the home page.
let lastUsageSegments = 10;
export function lastKnownUsageSegments(): number {
  return lastUsageSegments;
}

export async function fetchUsage(): Promise<{ used: number; remaining: number; segments: number; requestCount: number; dailyLimit: number }> {
  const response = await apiFetch(`${EXPENSIVE_API_BASE}/api/usage`, {
    cache: "no-store",
    headers: identityHeaders(),
  });

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new APIError(detail || `Usage failed with status ${response.status}`, response.status);
  }

  const usage = await response.json();
  if (typeof usage?.segments === "number") lastUsageSegments = usage.segments;
  return usage;
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
