import { upgradeLegacyTimelineNoteLayout } from "./note-layout";
import {
  applyTimelineGraphAction, applyTimelineLineageChanges, applyTimelineNodeColorChanges, applyTimelineNoteChanges,
} from "./timeline-actions";
import type {
  LineageChange, TimelineData, TimelineGraphAction, TimelineNodeColorChange, TimelineNoteChange,
} from "./types";

/**
 * Canvas edits as operations (Phase B). The same reducer the browser uses to apply an edit runs on the server in
 * the ops route, so the app, the in-app agent and MCP clients all change a canvas the same way, and every change is
 * logged with who made it.
 */
type Locked = { lockedOpenalexIds?: string[] };
export type CanvasOp =
  | (TimelineGraphAction & Locked)
  | ({ type: "lineage_changes"; changes: LineageChange[] } & Locked)
  | { type: "note_changes"; changes: TimelineNoteChange[] }
  | { type: "node_color_changes"; changes: TimelineNodeColorChange[] }
  /** Undo and redo put back a whole earlier state of the canvas. */
  | { type: "restore"; data: TimelineData };
export type CanvasOpSource = "ui" | "agent" | "mcp";

export const MAX_OPS_PER_COMMIT = 200;

const OP_TYPES = new Set<CanvasOp["type"]>([
  "highlight_node", "delete_node", "move_node", "set_node_group", "move_group", "rename_group", "shift_canvas",
  "add_paper", "add_note", "add_notes", "update_note", "delete_note", "connect_note", "disconnect_note",
  "lineage_changes", "note_changes", "node_color_changes", "restore",
]);

/** A structural check: known `type` and a plain object. The reducer ignores ops that point at missing items. */
export function isCanvasOp(value: unknown): value is CanvasOp {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const op = value as { type?: unknown; changes?: unknown; data?: unknown };
  if (!OP_TYPES.has(op.type as CanvasOp["type"])) return false;
  if (op.type === "lineage_changes" || op.type === "note_changes" || op.type === "node_color_changes") return Array.isArray(op.changes);
  if (op.type === "restore") return !!op.data && typeof op.data === "object" && typeof (op.data as TimelineData).nodes === "object";
  return true;
}

export function applyCanvasOp(data: TimelineData, op: CanvasOp): TimelineData {
  const options = { lockedOpenalexIds: "lockedOpenalexIds" in op ? op.lockedOpenalexIds : undefined };
  switch (op.type) {
    case "lineage_changes": return applyTimelineLineageChanges(data, op.changes, options);
    case "note_changes": return applyTimelineNoteChanges(data, op.changes);
    case "node_color_changes": return applyTimelineNodeColorChanges(data, op.changes);
    case "restore": return op.data;
    default: return applyTimelineGraphAction(data, op, options);
  }
}

export function applyCanvasOps(data: TimelineData, ops: CanvasOp[]): TimelineData {
  return ops.reduce(applyCanvasOp, data);
}

/** What a canvas looks like once loaded: older saves get their notes re-laid out, in the browser and server alike. */
export const loadCanvasData = upgradeLegacyTimelineNoteLayout;
