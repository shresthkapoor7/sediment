"use client";

import { useMemo, useSyncExternalStore } from "react";

const key = "sediment_feed_saved";
const event = "sediment-feed-bookmarks";
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
export function useFeedBookmarks() {
  const raw = useSyncExternalStore(subscribe, snapshot, () => "[]");
  const saved = useMemo(() => {
    try {
      const ids: unknown = JSON.parse(raw);
      return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
    } catch { return []; }
  }, [raw]);
  function toggle(id: string) {
    const next = saved.includes(id) ? saved.filter(value => value !== id) : [...saved, id];
    localStorage.setItem(key, JSON.stringify(next));
    window.dispatchEvent(new Event(event));
  }
  return { saved, toggle };
}
