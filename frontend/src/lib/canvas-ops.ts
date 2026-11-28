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
/**
 * Papers are addressed by numeric node id, but those ids are handed out in order, so a paper someone else added
 * first can take the id this browser used. Ops therefore also carry the paper's openalexId (`paperRef` for the
 * paper the op acts on, `connectRef` for the one it links to), and every replay (server retry, browser rebase)
 * resolves the id from it. An op whose paper is gone does nothing.
 */
export type PaperRefs = { paperRef?: string; connectRef?: string };
export type CanvasOp =
  | (TimelineGraphAction & Locked & PaperRefs)
  | ({ type: "lineage_changes"; changes: LineageChange[] } & Locked)
  | { type: "note_changes"; changes: TimelineNoteChange[] }
  | { type: "node_color_changes"; changes: TimelineNodeColorChange[] }
  /** Undo and redo put back a whole earlier state of the canvas. */
  | { type: "restore"; data: TimelineData };
export type CanvasOpSource = "ui" | "agent" | "mcp";

export const MAX_OPS_PER_COMMIT = 200;

// Boundary validation: ops arrive as JSON from the browser, so check every field the reducer reads.
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const optStr = (v: unknown) => v === undefined || isStr(v);
const optNodeId = (v: unknown) => v === undefined || v === null || isNum(v);
const strArr = (v: unknown) => Array.isArray(v) && v.every(isStr);
const arrOf = (v: unknown, item: (x: unknown) => boolean) => Array.isArray(v) && v.every(item);
const isNote = (v: unknown) => isObj(v) && isStr(v.id) && isNum(v.x) && isNum(v.y);
const isPaper = (v: unknown) => isObj(v) && isStr(v.openalexId);

function isTimelineData(v: unknown): v is TimelineData {
  if (!isObj(v) || !isObj(v.nodes) || !isObj(v.adjacency) || !isNum(v.lanes) || !isNum(v.rootId)) return false;
  if (!Object.values(v.nodes).every((n) => isObj(n) && isNum(n.id) && isNum(n.x) && isNum(n.y) && isPaper(n.paper))) return false;
  if (!Object.values(v.adjacency).every((c) => arrOf(c, isNum))) return false;
  if (v.notes !== undefined && !(isObj(v.notes) && Object.values(v.notes).every(isNote))) return false;
  if (v.noteEdges !== undefined && !arrOf(v.noteEdges, (e) => isObj(e) && isStr(e.noteId) && isNum(e.nodeId))) return false;
  return true;
}

const VALIDATORS: Record<CanvasOp["type"], (op: Obj) => boolean> = {
  highlight_node: (o) => isNum(o.nodeId) && (o.borderColor === null || isStr(o.borderColor)),
  delete_node: (o) => isNum(o.nodeId),
  move_node: (o) => isNum(o.nodeId) && isNum(o.x) && isNum(o.y),
  set_node_group: (o) => isNum(o.nodeId) && (o.group === null || isStr(o.group)),
  move_group: (o) => isStr(o.label) && isNum(o.dx) && isNum(o.dy),
  rename_group: (o) => isStr(o.from) && (o.to === null || isStr(o.to)),
  shift_canvas: (o) => isNum(o.dx) && isNum(o.dy),
  add_paper: (o) => isPaper(o.paper) && isNum(o.x) && isNum(o.y) && optNodeId(o.connectToNodeId),
  add_note: (o) => isNote(o.note) && optNodeId(o.connectToNodeId) && optStr(o.relation),
  add_notes: (o) => arrOf(o.notes, isNote) && optNodeId(o.connectToNodeId) && optStr(o.relation),
  update_note: (o) => isStr(o.noteId) && isObj(o.patch),
  delete_note: (o) => isStr(o.noteId),
  connect_note: (o) => isStr(o.noteId) && isNum(o.nodeId) && optStr(o.relation),
  disconnect_note: (o) => isStr(o.noteId) && isNum(o.nodeId),
  lineage_changes: (o) => arrOf(o.changes, (c) => isObj(c) && arrOf(c.addedPapers, isPaper) && strArr(c.removedPaperIds)
    && Array.isArray(c.edges) && (c.groups === undefined || Array.isArray(c.groups))),
  note_changes: (o) => arrOf(o.changes, (c) => isObj(c) && Array.isArray(c.createdNotes) && Array.isArray(c.updatedNotes)
    && strArr(c.deletedNoteIds) && Array.isArray(c.connections) && Array.isArray(c.disconnections)),
  node_color_changes: (o) => arrOf(o.changes, (c) => isObj(c) && isStr(c.paperId) && (c.borderColor === null || isStr(c.borderColor))),
  restore: (o) => isTimelineData(o.data),
};

/** Checks the op's type and every field the reducer relies on. The reducer ignores ops that point at missing items. */
export function isCanvasOp(value: unknown): value is CanvasOp {
  if (!isObj(value) || !isStr(value.type) || !Object.hasOwn(VALIDATORS, value.type)) return false;
  if (!optStr(value.paperRef) || !optStr(value.connectRef)) return false;
  if (value.lockedOpenalexIds !== undefined && !strArr(value.lockedOpenalexIds)) return false;
  return VALIDATORS[value.type as CanvasOp["type"]](value);
}

const openalexOf = (data: TimelineData, nodeId: number | null | undefined) =>
  nodeId == null ? undefined : data.nodes[nodeId]?.paper.openalexId;
const nodeIdOf = (data: TimelineData, openalexId: string) =>
  Object.values(data.nodes).find((node) => node.paper.openalexId === openalexId)?.id;

/** Adds the paper references for `op` as `data` stands now (the state the user acted on). */
export function withPaperRefs(data: TimelineData, op: CanvasOp): CanvasOp {
  if ("nodeId" in op) {
    const paperRef = openalexOf(data, op.nodeId);
    if (paperRef) op = { ...op, paperRef };
  }
  if ("connectToNodeId" in op) {
    const connectRef = openalexOf(data, op.connectToNodeId);
    if (connectRef) op = { ...op, connectRef };
  }
  return op;
}

/** Re-points `op` at the current ids of the papers it references; null when one of them is no longer there. */
function resolvePaperRefs(data: TimelineData, op: CanvasOp): CanvasOp | null {
  if ("nodeId" in op && "paperRef" in op && op.paperRef) {
    const nodeId = nodeIdOf(data, op.paperRef);
    if (nodeId === undefined) return null;
    if (nodeId !== op.nodeId) op = { ...op, nodeId };
  }
  if ("connectToNodeId" in op && "connectRef" in op && op.connectRef) {
    const connectToNodeId = nodeIdOf(data, op.connectRef) ?? null;
    if (connectToNodeId !== op.connectToNodeId) op = { ...op, connectToNodeId };
  }
  return op;
}

export function applyCanvasOp(data: TimelineData, input: CanvasOp): TimelineData {
  const op = resolvePaperRefs(data, input);
  if (!op) return data;
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
