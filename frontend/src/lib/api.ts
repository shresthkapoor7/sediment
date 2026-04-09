import { ChatSuggestion, GlobalChatResponse, LineageGraphResponse, TimelineNode, TraversalSettings } from "./types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

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
    throw new Error(detail || `Search failed with status ${response.status}`);
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
    throw new Error(detail || `Expand failed with status ${response.status}`);
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
    throw new Error(detail || `Chat failed with status ${response.status}`);
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
    throw new Error(detail || `Chat failed with status ${response.status}`);
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
