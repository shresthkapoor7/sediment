import { APIError } from "./api";

export type FeedDomain = "ai" | "biomed" | "math_physics" | "general";
export const domainLabels: Record<FeedDomain, string> = { ai: "AI & computer science", biomed: "Biology & medicine", math_physics: "Math & physics", general: "All fields" };
export type FeedSource = "arxiv" | "huggingface" | "openalex" | "biorxiv" | "medrxiv" | "journals" | "repositories";
export type FeedFilter = FeedSource | "all";
export type FeedPaper = {
  id: string;
  title: string;
  abstract: string;
  authors: string[];
  published: string | null;
  updated: string | null;
  doi: string | null;
  arxiv_id: string | null;
  openalex_id: string | null;
  topics: string[];
  sources: FeedSource[];
  url: string;
  thumbnail: string | null;
  preprint: boolean;
};
export type Feed = {
  domain: FeedDomain;
  availableSources: FeedSource[];
  source: FeedFilter;
  interests: string;
  queries: string[];
  papers: FeedPaper[];
  cursor: string | null;
  refreshedAt: string | null;
  warnings: FeedSource[];
  revision: string | null;
};
export type FeedAction = "interests" | "refresh" | "more" | "source";
export const sourceLabels: Record<FeedSource, string> = { arxiv: "arXiv", huggingface: "Hugging Face", openalex: "OpenAlex", biorxiv: "bioRxiv", medrxiv: "medRxiv", journals: "Journals", repositories: "Repositories" };
const base = process.env.NEXT_PUBLIC_USE_API_PROXY === "true" ? "" : (process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000");

const sessionKey = "sediment_feed_session";
let credential: string | null = null;
let storageChecked = false;
let sessionRequest: Promise<string> | null = null;

async function feedCredential(): Promise<string> {
  if (credential) return credential;
  if (!storageChecked) {
    storageChecked = true;
    try { credential = localStorage.getItem(sessionKey); } catch { /* Use memory when storage is blocked. */ }
  }
  if (credential) return credential;
  if (!sessionRequest) {
    sessionRequest = (async () => {
      const response = await fetch(`${base}/api/feed-session`, { method: "POST", credentials: "omit", cache: "no-store" });
      if (!response.ok) throw new APIError("Couldn’t start a feed session. Please try again.", response.status);
      const data = await response.json();
      if (typeof data.token !== "string") throw new APIError("Invalid feed session response.", 502);
      credential = data.token;
      try { localStorage.setItem(sessionKey, data.token); } catch { /* Keep this session usable in memory. */ }
      return data.token as string;
    })().finally(() => { sessionRequest = null; });
  }
  return sessionRequest;
}

export async function fetchFeed(update?: { action: FeedAction; source?: FeedFilter; domain?: FeedDomain; interests?: string; cursor?: string }, signal?: AbortSignal): Promise<Feed> {
  const send = async () => fetch(`${base}/api/feeds`, {
    method: update ? "POST" : "GET",
    headers: { Authorization: `Bearer ${await feedCredential()}`, ...(update ? { "Content-Type": "application/json" } : {}) },
    ...(update ? { body: JSON.stringify(update) } : {}),
    // No cookie authentication: a cross-site form cannot authorize mutations.
    credentials: "omit",
    cache: "no-store",
    signal,
  });
  let response = await send();
  if (response.status === 401) {
    credential = null;
    try { localStorage.removeItem(sessionKey); } catch { /* Memory fallback remains available. */ }
    if (!update) response = await send();
  }
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new APIError(typeof data?.detail === "string" ? data.detail : "Couldn’t load your feed. Please try again.", response.status);
  }
  return response.json();
}

export function feedPaperPath(paper: FeedPaper): string {
  return `/${encodeURIComponent(paper.id.replace(":", "-").replaceAll("/", "_"))}`;
}
