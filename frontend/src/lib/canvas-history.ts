"use client";

import { useCallback, useRef, useState } from "react";
import type { TimelineData, TimelineGraphAction } from "./types";

export interface HistoryMeta {
  label: string;
  /** Edits with the same key close together count as one step (a drag, typing in a note). */
  key?: string;
  /** How long after the previous edit with the same key it still merges. */
  windowMs?: number;
}

export interface HistoryItem {
  id: number;
  label: string;
  /** How many steps undoing (or redoing) to this item takes. */
  steps: number;
}

interface Entry {
  id: number;
  label: string;
  /** For the undo list: the canvas before this step. For the redo list: the canvas after it. */
  data: TimelineData;
  key?: string;
  at: number;
}

const MAX_STEPS = 50;
const DEFAULT_WINDOW_MS = 1500;

function quoted(title: string | undefined): string {
  const text = (title ?? "").trim();
  if (!text) return "paper";
  return `"${text.length > 36 ? `${text.slice(0, 35).trimEnd()}…` : text}"`;
}

/** A short name for what an action did, or null when it is housekeeping that should not be undoable. */
export function describeGraphAction(data: TimelineData, action: TimelineGraphAction): HistoryMeta | null {
  switch (action.type) {
    case "shift_canvas":
      return null;
    case "move_node":
      return { label: `Moved ${quoted(data.nodes[action.nodeId]?.paper.title)}`, key: `move:${action.nodeId}` };
    case "move_group":
      return { label: `Moved cluster "${action.label}"`, key: `move-group:${action.label}` };
    case "set_node_group": {
      const title = quoted(data.nodes[action.nodeId]?.paper.title);
      // Dropping a card into a cluster follows its move, so the two read as one step.
      return {
        label: action.group ? `Added ${title} to "${action.group}"` : `Took ${title} out of its cluster`,
        key: `move:${action.nodeId}`,
      };
    }
    case "rename_group":
      return { label: action.to ? `Renamed cluster to "${action.to}"` : `Dissolved cluster "${action.from}"` };
    case "highlight_node":
      return { label: `Changed colour of ${quoted(data.nodes[action.nodeId]?.paper.title)}` };
    case "delete_node":
      return { label: `Removed ${quoted(data.nodes[action.nodeId]?.paper.title)}` };
    case "add_paper":
      return { label: `Added ${quoted(action.paper.title)}` };
    case "add_note":
      return { label: "Added a note" };
    case "add_notes":
      return { label: `Added ${action.notes.length} notes` };
    case "update_note":
      return { label: "Edited a note", key: `note:${action.noteId}` };
    case "delete_note":
      return { label: "Deleted a note" };
    case "connect_note":
      return { label: "Linked a note to a paper" };
    case "disconnect_note":
      return { label: "Unlinked a note from a paper" };
    default:
      return { label: "Edited the canvas" };
  }
}

/** Undo and redo for the canvas: whole-canvas snapshots, so any change can be stepped back. */
export function useCanvasHistory() {
  const stacks = useRef<{ undo: Entry[]; redo: Entry[] }>({ undo: [], redo: [] });
  const nextId = useRef(1);
  const [lists, setLists] = useState<{ undo: HistoryItem[]; redo: HistoryItem[] }>({ undo: [], redo: [] });

  const publish = useCallback(() => {
    const { undo, redo } = stacks.current;
    setLists({
      undo: [...undo].reverse().map((entry, index) => ({ id: entry.id, label: entry.label, steps: index + 1 })),
      redo: [...redo].reverse().map((entry, index) => ({ id: entry.id, label: entry.label, steps: index + 1 })),
    });
  }, []);

  /** Remember the canvas as it was before a change. */
  const record = useCallback((before: TimelineData, meta: HistoryMeta) => {
    const { undo, redo } = stacks.current;
    const now = Date.now();
    const last = undo[undo.length - 1];
    // Never merge across an undo: the step after an undo starts fresh, or undoing it would undo too much.
    const mergeable = redo.length === 0 && last && last.key === meta.key && now - last.at < (meta.windowMs ?? DEFAULT_WINDOW_MS);
    if (meta.key && mergeable) {
      last.at = now;
      last.label = meta.label;
    } else {
      undo.push({ id: nextId.current++, label: meta.label, data: before, key: meta.key, at: now });
      if (undo.length > MAX_STEPS) undo.shift();
    }
    redo.length = 0;
    publish();
  }, [publish]);

  /** Step back; returns the canvas to show, or null when there is nothing to undo. */
  const undo = useCallback((current: TimelineData, steps = 1): TimelineData | null => {
    const { undo: back, redo: forward } = stacks.current;
    let working = current;
    for (let i = 0; i < steps; i += 1) {
      const entry = back.pop();
      if (!entry) break;
      forward.push({ id: entry.id, label: entry.label, data: working, at: 0 });
      working = entry.data;
    }
    if (working === current) return null;
    publish();
    return working;
  }, [publish]);

  const redo = useCallback((current: TimelineData, steps = 1): TimelineData | null => {
    const { undo: back, redo: forward } = stacks.current;
    let working = current;
    for (let i = 0; i < steps; i += 1) {
      const entry = forward.pop();
      if (!entry) break;
      back.push({ id: entry.id, label: entry.label, data: working, at: 0 });
      working = entry.data;
    }
    if (working === current) return null;
    publish();
    return working;
  }, [publish]);

  const clear = useCallback(() => {
    stacks.current = { undo: [], redo: [] };
    publish();
  }, [publish]);

  return { undoItems: lists.undo, redoItems: lists.redo, record, undo, redo, clear };
}
