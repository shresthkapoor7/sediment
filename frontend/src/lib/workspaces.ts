"use client";

import { useMemo, useSyncExternalStore } from "react";

// Workspace categories live in this browser, next to the anonymous user id the canvases belong to.
// A canvas is in at most one category; anything not listed is "Unsorted".
// `icon` and `color` are ids from the category picker; both are optional and fall back to a plain folder.
export type WorkspaceCategory = { id: string; name: string; graphIds: string[]; icon?: string; color?: string };
export type CategoryLook = { icon?: string; color?: string };

const key = "sediment_workspaces_v1";
const event = "sediment-workspaces";

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(event, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(event, callback);
  };
}
// Used when the browser refuses storage, so changes still last until the page reloads.
let memory: string | null = null;
const snapshot = () => {
  if (memory !== null) return memory;
  try { return localStorage.getItem(key) || "[]"; } catch { return "[]"; }
};
const serverSnapshot = () => "[]";

function parse(raw: string): WorkspaceCategory[] {
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.flatMap(entry => {
      if (!entry || typeof entry !== "object" || typeof entry.id !== "string" || typeof entry.name !== "string") return [];
      const ids = Array.isArray(entry.graphIds) ? entry.graphIds.filter((id: unknown): id is string => typeof id === "string") : [];
      return [{
        id: entry.id, name: entry.name, graphIds: [...new Set<string>(ids)],
        ...(typeof entry.icon === "string" ? { icon: entry.icon } : {}), ...(typeof entry.color === "string" ? { color: entry.color } : {}),
      }];
    });
  } catch { return []; }
}

function write(categories: WorkspaceCategory[]) {
  const raw = JSON.stringify(categories);
  try { localStorage.setItem(key, raw); memory = null; } catch { memory = raw; }
  window.dispatchEvent(new Event(event));
}
const read = () => parse(snapshot());

export const UNSORTED = "unsorted";

/** The list with `id` moved into `targetId`'s place (the same list when nothing would change). */
export function reorderedCategories<T extends { id: string }>(list: T[], id: string, targetId: string): T[] {
  const from = list.findIndex(category => category.id === id);
  const to = list.findIndex(category => category.id === targetId);
  if (from < 0 || to < 0 || from === to) return list;
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export function useWorkspaces() {
  const raw = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const categories = useMemo(() => parse(raw), [raw]);
  return {
    categories,
    create(name: string, look: CategoryLook = {}) {
      const clean = name.trim().slice(0, 60);
      if (!clean) return null;
      const id = crypto.randomUUID();
      write([...read(), { id, name: clean, graphIds: [], ...look }]);
      return id;
    },
    rename(id: string, name: string) {
      const clean = name.trim().slice(0, 60);
      if (!clean) return;
      write(read().map(category => category.id === id ? { ...category, name: clean } : category));
    },
    restyle(id: string, look: CategoryLook) {
      write(read().map(category => category.id === id ? { ...category, ...look } : category));
    },
    remove(id: string) { write(read().filter(category => category.id !== id)); },
    /** Moves a category into another's place; the categories between them shift over by one. */
    reorder(id: string, targetId: string) {
      const list = read();
      const next = reorderedCategories(list, id, targetId);
      if (next !== list) write(next);
    },
    /** Files a canvas into a category (or back to Unsorted), before `beforeId` when given, otherwise last. */
    move(graphId: string, target: string, beforeId?: string | null) {
      const next = read().map(category => ({ ...category, graphIds: category.graphIds.filter(id => id !== graphId) }));
      if (target !== UNSORTED) {
        const category = next.find(entry => entry.id === target);
        if (!category) return;
        const at = beforeId ? category.graphIds.indexOf(beforeId) : -1;
        if (at >= 0) category.graphIds.splice(at, 0, graphId); else category.graphIds.push(graphId);
      }
      write(next);
    },
    /** Forget canvases that no longer exist. */
    prune(existing: Set<string>) {
      const current = read();
      if (current.every(category => category.graphIds.every(id => existing.has(id)))) return;
      write(current.map(category => ({ ...category, graphIds: category.graphIds.filter(id => existing.has(id)) })));
    },
  };
}
