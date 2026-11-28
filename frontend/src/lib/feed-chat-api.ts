import { APIError, apiFetch, identityHeaders } from "./api";
import type { FeedPaper } from "./feeds-api";

const base = process.env.NEXT_PUBLIC_USE_API_PROXY === "true" ? "" : (process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000");

export type FeedChatEvent =
  | { type: "tool_started"; name: string }
  | { type: "tool_completed"; name: string; status?: string }
  | { type: "text_delta"; text: string }
  | { type: "mark_papers"; papers: FeedPaper[] }
  | { type: "interests_change"; interests: string }
  | { type: "papers_shown"; papers: FeedPaper[] }
  | { type: "workspace_offer"; papers: FeedPaper[] }
  | { type: "message_completed"; response: { text: string } }
  | { type: "error"; detail: string; statusCode?: number };

export interface FeedChatRequest {
  question: string;
  interests: string;
  domain: string;
  feedPapers: FeedPaper[];
  markedPapers: FeedPaper[];
  mentionedPaperIds: string[];
  /** The conversation so far. Nothing is kept on the server. */
  history: { role: "user" | "assistant"; content: string }[];
}

const brief = (paper: FeedPaper) => ({
  id: paper.id,
  title: paper.title,
  abstract: paper.abstract.slice(0, 4000),
  authors: paper.authors.slice(0, 20),
  published: paper.published,
  topics: paper.topics.slice(0, 5),
  url: paper.url,
});

/** Ask the feed assistant; events stream in as it works. */
export async function streamFeedChat(body: FeedChatRequest, onEvent: (event: FeedChatEvent) => void, signal?: AbortSignal): Promise<void> {
  const response = await apiFetch(`${base}/api/feed-chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream", ...identityHeaders() },
    body: JSON.stringify({
      ...body,
      feedPapers: body.feedPapers.slice(0, 40).map(brief),
      // Tagged papers first, so the cap never drops the paper a question is about.
      markedPapers: [
        ...body.markedPapers.filter((paper) => body.mentionedPaperIds.includes(paper.id)),
        ...body.markedPapers.filter((paper) => !body.mentionedPaperIds.includes(paper.id)),
      ].slice(0, 30).map(brief),
      mentionedPaperIds: body.mentionedPaperIds.slice(0, 30),
      history: body.history.slice(-16).map((turn) => ({ ...turn, content: turn.content.slice(0, 8000) })),
    }),
    signal,
  });
  if (!response.ok || !response.body) {
    let detail = "";
    try { detail = (await response.json()).detail; } catch { /* not JSON */ }
    throw new APIError(typeof detail === "string" && detail ? detail : `Chat failed with status ${response.status}`, response.status);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed = false;
  const consume = (raw: string) => {
    const lines = raw.split(/\r?\n/);
    const type = lines.find((line) => line.startsWith("event: "))?.slice(7).trim();
    const data = lines.filter((line) => line.startsWith("data: ")).map((line) => line.slice(6)).join("\n");
    if (!type || !data) return;
    const event = { type, ...JSON.parse(data) } as FeedChatEvent;
    onEvent(event);
    if (event.type === "message_completed") completed = true;
    if (event.type === "error") throw new APIError(event.detail, event.statusCode ?? 500);
  };
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const parts = buffer.split(/\r?\n\r?\n/);
    buffer = parts.pop() ?? "";
    parts.forEach(consume);
    if (done) break;
  }
  if (buffer.trim()) consume(buffer);
  if (!completed) throw new APIError("The reply was cut off. Try again.", 502);
}
