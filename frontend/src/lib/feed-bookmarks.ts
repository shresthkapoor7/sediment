"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { FeedPaper, feedPaperPath } from "./feeds-api";

const key = "sediment_feed_saved";
const event = "sediment-feed-bookmarks";
type Bookmark = string | FeedPaper;
const attempted = new Set<string>();
const base = process.env.NEXT_PUBLIC_USE_API_PROXY === "true" ? "" : (process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000");
function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(event, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(event, callback);
  };
}
function snapshot() {
  try { return localStorage.getItem(key) || "[]"; } catch { return "[]"; }
}
function parse(raw: string): Bookmark[] {
  try {
    const entries: unknown = JSON.parse(raw);
    if (!Array.isArray(entries)) return [];
    return entries.filter((value): value is Bookmark => typeof value === "string" || (
      value && typeof value === "object" && typeof value.id === "string" && typeof value.title === "string"
      && typeof value.abstract === "string" && typeof value.url === "string"
      && Array.isArray(value.authors) && Array.isArray(value.topics) && Array.isArray(value.sources)
    ));
  } catch { return []; }
}
const idOf = (entry: Bookmark) => typeof entry === "string" ? entry : entry.id;
function write(entries: Bookmark[]) {
  localStorage.setItem(key, JSON.stringify(entries));
  window.dispatchEvent(new Event(event));
}
async function restoreLegacy(ids: string[]) {
  const queue = ids.filter(id => !attempted.has(id));
  queue.forEach(id => attempted.add(id));
  // Bound simultaneous lookups when restoring an older bookmark collection.
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
    for (let id = queue.shift(); id; id = queue.shift()) {
      try {
        const path = feedPaperPath({ id } as FeedPaper);
        const response = await fetch(`${base}/api/feed-papers/${path.slice(1)}`, { signal: AbortSignal.timeout(15000) });
        if (!response.ok) continue;
        const paper = await response.json();
        if (!parse(JSON.stringify([paper])).some(entry => typeof entry !== "string")) continue;
        // Re-read storage: never resurrect a bookmark removed during the lookup.
        const current = parse(snapshot());
        if (current.includes(id)) write(current.map(entry => entry === id ? { ...paper, id } : entry));
      } catch { /* Retain the original ID so restoration can be retried. */ }
    }
  }));
}
export function useFeedBookmarks() {
  const raw = useSyncExternalStore(subscribe, snapshot, () => "[]");
  const entries = useMemo(() => parse(raw), [raw]);
  const saved = entries.map(idOf);
  const papers = entries.filter((entry): entry is FeedPaper => typeof entry !== "string");
  const unresolved = entries.filter((entry): entry is string => typeof entry === "string");
  useEffect(() => {
    void restoreLegacy(parse(raw).filter((entry): entry is string => typeof entry === "string"));
  }, [raw]);
  function toggle(paper: FeedPaper) {
    const current = parse(snapshot());
    write(current.some(entry => idOf(entry) === paper.id)
      ? current.filter(entry => idOf(entry) !== paper.id) : [...current, paper]);
  }
  function retryRestore() {
    unresolved.forEach(id => attempted.delete(id));
    void restoreLegacy(unresolved);
  }
  return { saved, papers, unresolved, toggle, retryRestore };
}
