"use client";

import { useMemo, useSyncExternalStore } from "react";
import { fetchWorkspaceLayout, saveWorkspaceLayout } from "@/lib/api";

// Anonymous: workspace categories live in this browser, next to the anonymous user id the canvases belong to.
// Signed in: they belong to the account and are saved on the server; the browser keeps a cached copy per account.
// A canvas is in at most one category; anything not listed is "Unsorted".
// `icon` and `color` are ids from the category picker; both are optional and fall back to a plain folder.
// `column` is which of the board's columns the category sits in (0 to BOARD_COLUMNS - 1); within a column,
// categories keep their order in the list.
export type WorkspaceCategory = { id: string; name: string; graphIds: string[]; icon?: string; color?: string; column?: number };
export type CategoryLook = { icon?: string; color?: string };

const baseKey = "sediment_workspaces_v1";
const event = "sediment-workspaces";

let owner: string | null = null;
const key = () => (owner ? `${baseKey}:${owner}` : baseKey);
const readKey = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const notify = () => window.dispatchEvent(new Event(event));

/**
 * Switches Workspaces to the signed-in account (or back to this browser's anonymous set with `null`).
 * On sign-in the account's saved categories are loaded; categories made anonymously in this browser are merged
 * in once and then cleared here, the same way the canvases themselves move to the account.
 */
export async function setWorkspaceOwner(accountId: string | null) {
  const generation = ++hydration;
  if (owner === accountId && !hydrating) { settled = true; notify(); return; }
  settled = false;
  owner = accountId;
  hydrating = false;
  memory = null;
  notify();
  if (!accountId) { settled = true; notify(); return; }
  // Hold saves until the account's layout has loaded, so an edit made meanwhile can't overwrite categories the
  // server has but this browser's cached copy doesn't.
  hydrating = true;
  const writesBefore = writeCount;
  try {
    const saved = parse(JSON.stringify((await fetchWorkspaceLayout()) ?? []));
    if (generation !== hydration) return;
    const anonymous = parse(readKey(baseKey) || "[]");
    // Edits made while loading win for the categories they touch; everything else comes from the server.
    const local = writeCount !== writesBefore ? read() : [];
    const merged = mergeCategories(mergeCategories(saved, anonymous), local);
    try { localStorage.setItem(key(), JSON.stringify(merged)); } catch { memory = JSON.stringify(merged); }
    hydrating = false;
    if (anonymous.length || local.length) await saveWorkspaceLayout(merged);
    // Another owner change started while saving: it settles itself, this one must not.
    if (generation !== hydration) return;
    if (anonymous.length) {
      try { localStorage.removeItem(baseKey); } catch { /* fine */ }
    }
    settled = true;
    notify();
  } catch (error) {
    if (generation !== hydration) return;
    // Offline or the API is down: keep showing the cached copy. Saves stay held (they could drop categories the
    // server has); the next sign-in or reload loads again.
    console.error("Loading workspaces from the account failed", error);
  }
}

let hydrating = false;
let writeCount = 0;
// Bumped by every owner change, so a load that finishes after a newer one leaves the shared state alone.
let hydration = 0;
// False until AuthProvider has settled who owns Workspaces (claim done, account layout loaded). Pruning against a
// canvas list waits for it, so canvases still being moved to the account are not dropped from their categories.
let settled = false;

/** `extra` categories on top of `base`: same id replaces in place, new ids are added. */
function mergeCategories(base: WorkspaceCategory[], extra: WorkspaceCategory[]): WorkspaceCategory[] {
  const byId = new Map(extra.map(category => [category.id, category]));
  const merged = base.map(category => byId.get(category.id) ?? category);
  const known = new Set(base.map(category => category.id));
  return [...extra.filter(category => !known.has(category.id)), ...merged];
}

// Saves to the account shortly after the last change, so a drag that writes several times sends one request.
let saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSave(categories: WorkspaceCategory[]) {
  if (!owner || hydrating) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveWorkspaceLayout(categories).catch(error => console.error("Saving workspaces failed", error));
  }, 600);
}

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
  try { return localStorage.getItem(key()) || "[]"; } catch { return "[]"; }
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
        ...(Number.isInteger(entry.column) && entry.column >= 0 && entry.column < BOARD_COLUMNS ? { column: entry.column } : {}),
      }];
    });
  } catch { return []; }
}

function write(categories: WorkspaceCategory[]) {
  const raw = JSON.stringify(categories);
  try { localStorage.setItem(key(), raw); memory = null; } catch { memory = raw; }
  writeCount += 1;
  notify();
  scheduleSave(categories);
}
const read = () => parse(snapshot());

export const UNSORTED = "unsorted";

export const BOARD_COLUMNS = 3;

/**
 * Each category's column. Categories saved before columns existed are laid out as the board used to be:
 * Unsorted in the first slot, then the newest category first, one per column in turn.
 */
export function categoryColumns(categories: WorkspaceCategory[]): Map<string, number> {
  const newestFirst = [...categories].reverse();
  return new Map(newestFirst.map((category, index) => [category.id, category.column ?? (index + 1) % BOARD_COLUMNS]));
}

export function useWorkspaces() {
  const raw = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  // Re-render when ownership settles, so a waiting prune runs.
  const ownerSettled = useSyncExternalStore(subscribe, () => settled, () => false);
  const categories = useMemo(() => parse(raw), [raw]);
  return {
    categories,
    ownerSettled,
    create(name: string, look: CategoryLook = {}, column?: number) {
      const clean = name.trim().slice(0, 60);
      if (!clean) return null;
      const id = crypto.randomUUID();
      const list = read();
      const columns = categoryColumns(list);
      // New categories go to the top of their column; the others keep theirs.
      write([...list.map(category => ({ ...category, column: columns.get(category.id) })), { id, name: clean, graphIds: [], ...look, ...(column === undefined ? {} : { column }) }]);
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
    /** Puts a category in a column, before `beforeId` when given, otherwise at the bottom of that column. */
    place(id: string, column: number, beforeId: string | null) {
      const list = read();
      const columns = categoryColumns(list);
      // Pin every category's column first, so moving one never shifts the others.
      const pinned = list.map(category => ({ ...category, column: category.id === id ? column : columns.get(category.id) }));
      const moving = pinned.find(category => category.id === id);
      if (!moving) return;
      const rest = pinned.filter(category => category.id !== id);
      // Lists run oldest to newest and columns show newest first, so "before X" on screen means after X here.
      const anchor = beforeId ? rest.findIndex(category => category.id === beforeId) : -1;
      if (anchor >= 0) rest.splice(anchor + 1, 0, moving);
      // Columns show newest first, so the very start of the list is the bottom of every column, including
      // narrow layouts where two columns fold into one stack.
      else rest.unshift(moving);
      write(rest);
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
    /** Forget canvases that no longer exist. Returns false (and does nothing) until the owner has settled. */
    prune(existing: Set<string>): boolean {
      if (!settled) return false;
      const current = read();
      if (current.every(category => category.graphIds.every(id => existing.has(id)))) return true;
      write(current.map(category => ({ ...category, graphIds: category.graphIds.filter(id => existing.has(id)) })));
      return true;
    },
  };
}
