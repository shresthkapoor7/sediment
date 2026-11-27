import { applyTimelineGraphAction } from "./timeline-actions";
import type { TimelineData, TimelineGraphAction } from "./types";

/**
 * Canvas edits as operations (Phase B). The same reducer the browser uses to apply an edit runs on the server in
 * the ops route, so the app, the in-app agent and MCP clients all change a canvas the same way, and every change is
 * logged with who made it.
 */
export type CanvasOp = TimelineGraphAction;
export type CanvasOpSource = "ui" | "agent" | "mcp";

export const MAX_OPS_PER_COMMIT = 200;

const OP_TYPES = new Set<CanvasOp["type"]>([
  "highlight_node", "delete_node", "move_node", "set_node_group", "move_group", "rename_group", "shift_canvas",
  "add_paper", "add_note", "add_notes", "update_note", "delete_note", "connect_note", "disconnect_note",
]);

/** A structural check: known `type` and a plain object. The reducer ignores ops that point at missing items. */
export function isCanvasOp(value: unknown): value is CanvasOp {
  return !!value && typeof value === "object" && !Array.isArray(value)
    && OP_TYPES.has((value as { type?: unknown }).type as CanvasOp["type"]);
}

export function applyCanvasOps(data: TimelineData, ops: CanvasOp[]): TimelineData {
  return ops.reduce((current, op) => applyTimelineGraphAction(current, op), data);
}
