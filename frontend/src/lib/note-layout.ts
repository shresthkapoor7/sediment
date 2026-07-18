import { NODE_DIMENSIONS, PADDING_X, PADDING_Y } from "./dummy-data";
import { TIMELINE_NOTE_DEFAULT_WIDTH, TIMELINE_NOTE_MIN_HEIGHT } from "./note-style";
import { TimelineData, TimelineNote, TimelineNode } from "./types";

const NOTE_CLEARANCE = 32;
const NOTE_MAX_WIDTH = 360;
const NOTE_MAX_HEIGHT = 390;

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface NoteDimensions {
  width: number;
  height: number;
}

/**
 * Gives generated notes enough room for their text before they ever reach the canvas.
 * This is deliberately deterministic: saved graphs render the same way after a refresh.
 */
export function estimateTimelineNoteDimensions(text: string): NoteDimensions {
  const compactText = text.replace(/[`*_>#\[\]()]/g, "").trim();
  const characterCount = compactText.length;
  const width = characterCount > 440
    ? NOTE_MAX_WIDTH
    : characterCount > 180
      ? Math.min(NOTE_MAX_WIDTH, TIMELINE_NOTE_DEFAULT_WIDTH + 28)
      : TIMELINE_NOTE_DEFAULT_WIDTH;
  const charactersPerLine = Math.max(28, Math.floor((width - 36) / 8.2));
  const estimatedLines = Math.max(
    1,
    compactText.split(/\n+/).reduce(
      (total, line) => total + Math.max(1, Math.ceil(line.length / charactersPerLine)),
      0,
    ),
  );
  const height = Math.min(
    NOTE_MAX_HEIGHT,
    Math.max(TIMELINE_NOTE_MIN_HEIGHT, 104 + estimatedLines * 23),
  );
  return { width, height };
}

export function layoutTimelineNotes(data: TimelineData, noteIds?: string[]): TimelineData {
  const notes = data.notes ?? {};
  const requestedIds = noteIds ?? Object.keys(notes);
  const targetIds = [...new Set(requestedIds)].filter((id) => Boolean(notes[id]));
  if (!targetIds.length) return data;

  const targetIdSet = new Set(targetIds);
  const connectionsByNoteId = new Map<string, number[]>();
  (data.noteEdges ?? []).forEach((edge) => {
    if (!data.nodes[edge.nodeId]) return;
    const nodeIds = connectionsByNoteId.get(edge.noteId) ?? [];
    if (!nodeIds.includes(edge.nodeId)) nodeIds.push(edge.nodeId);
    connectionsByNoteId.set(edge.noteId, nodeIds);
  });

  const placedRects: Rect[] = [
    ...Object.values(data.nodes).map(nodeRect),
    ...Object.values(notes)
      .filter((note) => !targetIdSet.has(note.id))
      .map(noteRect),
  ];
  const nextNotes = { ...notes };
  const orderedIds = [...targetIds].sort((a, b) => {
    const connectionDifference = (connectionsByNoteId.get(b)?.length ?? 0) - (connectionsByNoteId.get(a)?.length ?? 0);
    return connectionDifference || a.localeCompare(b);
  });

  orderedIds.forEach((noteId, index) => {
    const note = nextNotes[noteId];
    if (!note) return;
    const dimensions = {
      width: note.width ?? estimateTimelineNoteDimensions(note.text).width,
      height: note.height ?? estimateTimelineNoteDimensions(note.text).height,
    };
    const linkedNodes = (connectionsByNoteId.get(noteId) ?? [])
      .map((nodeId) => data.nodes[nodeId])
      .filter((node): node is TimelineNode => Boolean(node));
    const position = chooseNotePosition(linkedNodes, dimensions, placedRects, index, data.nodes);
    nextNotes[noteId] = {
      ...note,
      ...dimensions,
      x: Math.round(position.x),
      y: Math.round(position.y),
    };
    placedRects.push({ ...position, ...dimensions });
  });

  return { ...data, notes: nextNotes };
}

/** Migrate saved cards that predate content-aware sizing and collision avoidance. */
export function upgradeLegacyTimelineNoteLayout(data: TimelineData): TimelineData {
  const legacyNoteIds = Object.values(data.notes ?? {})
    .filter((note) => (
      note.width === undefined
      || note.height === undefined
      || (note.width === 220 && note.height === 132)
    ))
    .map((note) => note.id);
  if (!legacyNoteIds.length) return data;

  const notes = { ...(data.notes ?? {}) };
  legacyNoteIds.forEach((noteId) => {
    const note = notes[noteId];
    if (!note) return;
    notes[noteId] = { ...note, ...estimateTimelineNoteDimensions(note.text) };
  });
  return layoutTimelineNotes({ ...data, notes }, legacyNoteIds);
}

function chooseNotePosition(
  linkedNodes: TimelineNode[],
  dimensions: NoteDimensions,
  placedRects: Rect[],
  index: number,
  nodes: Record<number, TimelineNode>,
): Pick<Rect, "x" | "y"> {
  const anchor = linkedNodes.length ? boundsForNodes(linkedNodes) : boundsForNodes(Object.values(nodes));
  const centerX = anchor.x + anchor.width / 2;
  const centerY = anchor.y + anchor.height / 2;
  const distance = NOTE_CLEARANCE + 44;
  const verticalStep = dimensions.height + NOTE_CLEARANCE;
  const candidates: Array<Pick<Rect, "x" | "y">> = [];
  const verticalOffsets = [0, -verticalStep, verticalStep, -verticalStep * 2, verticalStep * 2];

  verticalOffsets.forEach((offset) => {
    candidates.push({ x: anchor.x + anchor.width + distance, y: centerY - dimensions.height / 2 + offset });
  });
  verticalOffsets.forEach((offset) => {
    candidates.push({ x: anchor.x - dimensions.width - distance, y: centerY - dimensions.height / 2 + offset });
  });
  candidates.push(
    { x: centerX - dimensions.width / 2, y: anchor.y + anchor.height + distance },
    { x: centerX - dimensions.width / 2, y: anchor.y - dimensions.height - distance },
  );

  // A bounded spiral keeps dense groups readable rather than piling cards on a single anchor.
  for (let ring = 1; ring <= 5; ring += 1) {
    const radiusX = ring * (dimensions.width * 0.58 + NOTE_CLEARANCE);
    const radiusY = ring * (dimensions.height * 0.54 + NOTE_CLEARANCE);
    candidates.push(
      { x: centerX + radiusX - dimensions.width / 2, y: centerY - dimensions.height / 2 },
      { x: centerX - radiusX - dimensions.width / 2, y: centerY - dimensions.height / 2 },
      { x: centerX - dimensions.width / 2, y: centerY + radiusY - dimensions.height / 2 },
      { x: centerX - dimensions.width / 2, y: centerY - radiusY - dimensions.height / 2 },
    );
  }

  const graphRight = Math.max(PADDING_X, ...Object.values(nodes).map((node) => node.x + NODE_DIMENSIONS.width));
  candidates.push({
    x: graphRight + distance,
    y: PADDING_Y + index * verticalStep,
  });

  return candidates.reduce<Pick<Rect, "x" | "y">>((best, candidate) => {
    const score = placementScore(candidate, dimensions, placedRects, centerX, centerY);
    const bestScore = placementScore(best, dimensions, placedRects, centerX, centerY);
    return score < bestScore ? candidate : best;
  }, candidates[0]);
}

function placementScore(
  position: Pick<Rect, "x" | "y">,
  dimensions: NoteDimensions,
  placedRects: Rect[],
  anchorX: number,
  anchorY: number,
): number {
  const rect = { ...position, ...dimensions };
  const overlapPenalty = placedRects.reduce(
    (total, placedRect) => total + overlapArea(rect, placedRect, NOTE_CLEARANCE),
    0,
  );
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  const anchorDistance = Math.hypot(centerX - anchorX, centerY - anchorY);
  const offCanvasPenalty = Math.max(0, PADDING_X - rect.x) * 800 + Math.max(0, PADDING_Y - rect.y) * 800;
  return overlapPenalty * 10_000 + anchorDistance * 0.12 + offCanvasPenalty;
}

function overlapArea(a: Rect, b: Rect, clearance: number): number {
  const padding = clearance / 2;
  const left = Math.max(a.x - padding, b.x - padding);
  const right = Math.min(a.x + a.width + padding, b.x + b.width + padding);
  const top = Math.max(a.y - padding, b.y - padding);
  const bottom = Math.min(a.y + a.height + padding, b.y + b.height + padding);
  return Math.max(0, right - left) * Math.max(0, bottom - top);
}

function boundsForNodes(nodes: TimelineNode[]): Rect {
  if (!nodes.length) {
    return { x: PADDING_X, y: PADDING_Y, width: NODE_DIMENSIONS.width, height: NODE_DIMENSIONS.height };
  }
  const left = Math.min(...nodes.map((node) => node.x));
  const top = Math.min(...nodes.map((node) => node.y));
  const right = Math.max(...nodes.map((node) => node.x + NODE_DIMENSIONS.width));
  const bottom = Math.max(...nodes.map((node) => node.y + NODE_DIMENSIONS.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function nodeRect(node: TimelineNode): Rect {
  return { x: node.x, y: node.y, width: NODE_DIMENSIONS.width, height: NODE_DIMENSIONS.height };
}

function noteRect(note: TimelineNote): Rect {
  const dimensions = estimateTimelineNoteDimensions(note.text);
  return {
    x: note.x,
    y: note.y,
    width: note.width ?? dimensions.width,
    height: note.height ?? dimensions.height,
  };
}
