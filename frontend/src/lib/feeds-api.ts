import { APIError } from "./api";

export type FeedSource = "arxiv" | "huggingface" | "openalex";
export type FeedFilter = FeedSource | "all";
export type FeedPaper = {
  id: string;
  title: string;
  abstract: string;
  authors: string[];
  published: string | null;
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
export const sourceLabels: Record<FeedSource, string> = { arxiv: "arXiv", huggingface: "Hugging Face", openalex: "OpenAlex" };
const base = process.env.NEXT_PUBLIC_USE_API_PROXY === "true" ? "" : (process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000");

export async function fetchFeed(userId: string, update?: { action: FeedAction; source?: FeedFilter; interests?: string; cursor?: string }, signal?: AbortSignal): Promise<Feed> {
  const response = await fetch(`${base}/api/feeds${update ? "" : `?userId=${encodeURIComponent(userId)}`}`, {
    method: update ? "POST" : "GET",
    ...(update ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId, ...update }) } : {}),
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new APIError(typeof data?.detail === "string" ? data.detail : "Couldn’t load your feed. Please try again.", response.status);
  }
  return response.json();
}
