import { GraphEdge, GraphPaper, LineageChange, NodeBorderColor, TimelineData, TimelineGraphAction, TimelineNode, TimelineNodeColorChange, TimelineNote, TimelineNoteChange } from "./types";
import { GAP_X, LANE_HEIGHT, NODE_DIMENSIONS, PADDING_X, PADDING_Y } from "./dummy-data";
import { estimateTimelineNoteDimensions, layoutTimelineNotes } from "./note-layout";

interface TimelineGraphActionOptions {
  lockedOpenalexIds?: string[];
}

export function applyTimelineGraphAction(
  data: TimelineData,
  action: TimelineGraphAction,
  options: TimelineGraphActionOptions = {},
): TimelineData {
  if (action.type === "highlight_node") {
    return applyNodeHighlight(data, action.nodeId, action.borderColor);
  }
  if (action.type === "delete_node") {
    return applyNodeDeletion(data, action.nodeId, options);
  }
  if (action.type === "add_note") {
    const next = applyNoteAddition(data, action);
    return next === data ? data : layoutTimelineNotes(next, [action.note.id]);
  }
  if (action.type === "update_note") {
    return applyNoteUpdate(data, action.noteId, action.patch);
  }
  if (action.type === "delete_note") {
    return applyNoteDeletion(data, action.noteId);
  }
  if (action.type === "connect_note") {
    return applyNoteConnection(data, action.noteId, action.nodeId, action.relation);
  }
  if (action.type === "disconnect_note") {
    return applyNoteDisconnection(data, action.noteId, action.nodeId);
  }
  return data;
}

export function applyTimelineLineageChanges(
  data: TimelineData,
  changes: LineageChange[],
  options: TimelineGraphActionOptions = {},
): TimelineData {
  return changes.reduce(
    (current, change) => applyTimelineLineageChange(current, change, options),
    data,
  );
}

export function applyTimelineNoteChanges(data: TimelineData, changes: TimelineNoteChange[]): TimelineData {
  return changes.reduce(
    (current, change) => applyTimelineNoteChange(current, change),
    data,
  );
}

export function applyTimelineNodeColorChanges(data: TimelineData, changes: TimelineNodeColorChange[]): TimelineData {
  return changes.reduce((current, change) => {
    const normalizedPaperId = normalizeOpenalexId(change.paperId);
    const node = Object.values(current.nodes).find(
      (candidate) => normalizeOpenalexId(candidate.paper.openalexId) === normalizedPaperId,
    );
    return node ? applyNodeHighlight(current, node.id, change.borderColor) : current;
  }, data);
}

function normalizeOpenalexId(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  return (trimmed.includes("/") ? trimmed.replace(/\/+$/, "").split("/").pop() ?? trimmed : trimmed).toUpperCase();
}

function isUsableGraphPaper(paper: GraphPaper | undefined | null): paper is GraphPaper {
  return Boolean(
    paper
    && typeof paper.openalexId === "string"
    && paper.openalexId.trim()
    && typeof paper.title === "string"
    && paper.title.trim(),
  );
}

function isUsableGraphEdge(edge: GraphEdge | undefined | null): edge is GraphEdge {
  return Boolean(
    edge
    && typeof edge.parentOpenalexId === "string"
    && typeof edge.childOpenalexId === "string"
    && (edge.relation === "influenced" || edge.relation === "inferred"),
  );
}

function graphPaperToTimelinePaper(paper: GraphPaper, id: number): TimelineNode["paper"] {
  return {
    id,
    openalexId: paper.openalexId,
    title: paper.title,
    year: paper.year ?? 0,
    summary: paper.summary ?? "",
    detail: paper.detail,
    authors: paper.authors ?? [],
    doi: paper.doi,
    oaUrl: paper.oaUrl,
    isOa: paper.isOa,
    oaStatus: paper.oaStatus,
    hasFulltext: paper.hasFulltext,
    hasContentPdf: paper.hasContentPdf,
    hasContentTei: paper.hasContentTei,
    oaLicense: paper.oaLicense,
    concepts: paper.concepts ?? [],
    type: paper.type,
    citedByCount: paper.citedByCount,
    referencesCount: paper.referencesCount,
  };
}

function cloneNodes(nodes: Record<number, TimelineNode>): Record<number, TimelineNode> {
  return Object.fromEntries(
    Object.entries(nodes).map(([id, node]) => [Number(id), {
      ...node,
      paper: { ...node.paper, authors: [...(node.paper.authors ?? [])] },
    }]),
  );
}

function cloneAdjacency(adjacency: Record<number, number[]>): Record<number, number[]> {
  return Object.fromEntries(
    Object.entries(adjacency).map(([id, children]) => [Number(id), [...children]]),
  );
}

function nextNumericId(nodes: Record<number, TimelineNode>): number {
  return Math.max(0, ...Object.keys(nodes).map(Number)) + 1;
}

function wouldCreateCycle(adjacency: Record<number, number[]>, parentId: number, childId: number): boolean {
  const queue = [childId];
  const visited = new Set<number>();
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === parentId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    queue.push(...(adjacency[current] ?? []));
  }
  return false;
}

function strongerRelation(
  current: GraphEdge["relation"] | undefined,
  incoming: GraphEdge["relation"],
): GraphEdge["relation"] {
  return current === "influenced" || incoming === "influenced" ? "influenced" : "inferred";
}

function applyTimelineLineageChange(
  data: TimelineData,
  change: LineageChange,
  options: TimelineGraphActionOptions,
): TimelineData {
  let next = data;
  const removalIds = new Set(
    (change.removedPaperIds ?? [])
      .map(normalizeOpenalexId)
      .filter(Boolean),
  );
  for (const node of Object.values(next.nodes)) {
    if (removalIds.has(normalizeOpenalexId(node.paper.openalexId))) {
      next = applyNodeDeletion(next, node.id, options);
    }
  }

  const additions = (change.addedPapers ?? []).filter(isUsableGraphPaper);
  const edges = (change.edges ?? []).filter(isUsableGraphEdge);
  if (additions.length === 0 && edges.length === 0) return next;

  const nodes = cloneNodes(next.nodes);
  const adjacency = cloneAdjacency(next.adjacency);
  const edgeRelations = { ...(next.edgeRelations ?? {}) };
  const numericIdByOpenalexId = new Map(
    Object.values(nodes).map((node) => [normalizeOpenalexId(node.paper.openalexId), node.id]),
  );
  const addedNodeIds: number[] = [];
  let nextLane = Math.max(next.lanes, ...Object.values(nodes).map((node) => node.lane + 1), 0);

  for (const paper of additions) {
    const normalizedId = normalizeOpenalexId(paper.openalexId);
    if (!normalizedId || numericIdByOpenalexId.has(normalizedId)) continue;
    const nodeId = nextNumericId(nodes);
    const node: TimelineNode = {
      id: nodeId,
      paper: graphPaperToTimelinePaper(paper, nodeId),
      x: PADDING_X,
      y: PADDING_Y + nextLane * LANE_HEIGHT,
      lane: nextLane,
      parentId: null,
      expanded: false,
      generation: 0,
    };
    nodes[nodeId] = node;
    adjacency[nodeId] = [];
    numericIdByOpenalexId.set(normalizedId, nodeId);
    addedNodeIds.push(nodeId);
    nextLane += 1;
  }

  for (const edge of edges) {
    const parentId = numericIdByOpenalexId.get(normalizeOpenalexId(edge.parentOpenalexId));
    const childId = numericIdByOpenalexId.get(normalizeOpenalexId(edge.childOpenalexId));
    if (!parentId || !childId || parentId === childId || wouldCreateCycle(adjacency, parentId, childId)) continue;
    const children = adjacency[parentId] ?? [];
    if (!children.includes(childId)) {
      adjacency[parentId] = [...children, childId];
    }
    edgeRelations[edgeKey(parentId, childId)] = strongerRelation(edgeRelations[edgeKey(parentId, childId)], edge.relation);
  }

  const columnWidth = NODE_DIMENSIONS.width + GAP_X;
  const defaultX = Math.max(PADDING_X, ...Object.values(next.nodes).map((node) => node.x + columnWidth));
  for (let pass = 0; pass < addedNodeIds.length + 1; pass += 1) {
    for (const nodeId of addedNodeIds) {
      const node = nodes[nodeId];
      if (!node) continue;
      const parentIds = Object.entries(adjacency)
        .filter(([, children]) => children.includes(nodeId))
        .map(([parentId]) => Number(parentId))
        .filter((parentId) => Boolean(nodes[parentId]));
      const childIds = (adjacency[nodeId] ?? []).filter((childId) => Boolean(nodes[childId]));
      const parentNodes = parentIds.map((parentId) => nodes[parentId]);
      const childNodes = childIds.map((childId) => nodes[childId]);
      const x = parentNodes.length > 0
        ? Math.max(...parentNodes.map((parent) => parent.x + columnWidth))
        : childNodes.length > 0
          ? Math.min(...childNodes.map((child) => child.x - columnWidth))
          : defaultX;
      const generation = parentNodes.length > 0
        ? Math.max(...parentNodes.map((parent) => parent.generation)) + 1
        : childNodes.length > 0
          ? Math.max(0, Math.min(...childNodes.map((child) => child.generation)) - 1)
          : Math.max(...Object.values(next.nodes).map((existing) => existing.generation), 0) + 1;
      nodes[nodeId] = {
        ...node,
        x,
        generation,
        parentId: parentIds[0] ?? null,
      };
    }
  }

  return {
    ...next,
    nodes,
    adjacency,
    edgeRelations,
    lanes: Math.max(next.lanes, nextLane),
  };
}

function applyTimelineNoteChange(data: TimelineData, change: TimelineNoteChange): TimelineData {
  let next = data;
  const timestamp = new Date().toISOString();
  const createdNoteIds: string[] = [];

  for (const created of change.createdNotes ?? []) {
    if (
      !created
      || typeof created.id !== "string"
      || !created.id.trim()
      || typeof created.text !== "string"
      || !created.text.trim()
      || next.notes?.[created.id]
    ) {
      continue;
    }
    const dimensions = estimateTimelineNoteDimensions(created.text);
    const note: TimelineNote = {
      id: created.id,
      text: created.text,
      kind: isNoteKind(created.kind) ? created.kind : "field_note",
      color: isNoteColor(created.color) ? created.color : "paper",
      x: PADDING_X,
      y: PADDING_Y,
      ...dimensions,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    next = applyNoteAddition(next, {
      type: "add_note",
      note,
    });
    createdNoteIds.push(created.id);
  }

  for (const update of change.updatedNotes ?? []) {
    if (!update || typeof update.noteId !== "string" || !next.notes?.[update.noteId]) continue;
    const patch = update.patch ?? {};
    const safePatch: Partial<TimelineNote> = {
      updatedAt: timestamp,
    };
    if (typeof patch.text === "string" && patch.text.trim()) safePatch.text = patch.text;
    if (isNoteKind(patch.kind)) safePatch.kind = patch.kind;
    if (isNoteColor(patch.color)) safePatch.color = patch.color;
    next = applyNoteUpdate(next, update.noteId, safePatch);
  }

  for (const noteId of change.deletedNoteIds ?? []) {
    if (typeof noteId === "string") next = applyNoteDeletion(next, noteId);
  }

  for (const connection of change.connections ?? []) {
    if (!connection || typeof connection.noteId !== "string") continue;
    const nodeId = nodeIdForPaper(next, connection.paperId);
    if (nodeId === null) continue;
    next = applyNoteConnection(next, connection.noteId, nodeId, connection.relation);
  }

  for (const connection of change.disconnections ?? []) {
    if (!connection || typeof connection.noteId !== "string") continue;
    const nodeId = nodeIdForPaper(next, connection.paperId);
    if (nodeId === null) continue;
    next = applyNoteDisconnection(next, connection.noteId, nodeId);
  }

  return createdNoteIds.length ? layoutTimelineNotes(next, createdNoteIds) : next;
}

function nodeIdForPaper(data: TimelineData, paperId: unknown): number | null {
  const normalizedId = normalizeOpenalexId(paperId);
  if (!normalizedId) return null;
  return Object.values(data.nodes).find((node) => normalizeOpenalexId(node.paper.openalexId) === normalizedId)?.id ?? null;
}

function isNoteKind(value: unknown): value is NonNullable<TimelineNote["kind"]> {
  return value === "field_note" || value === "question" || value === "insight" || value === "todo" || value === "contradiction";
}

function isNoteColor(value: unknown): value is NonNullable<TimelineNote["color"]> {
  return value === "paper" || value === "amber" || value === "blue" || value === "green" || value === "rose";
}

function applyNodeHighlight(
  data: TimelineData,
  nodeId: number,
  borderColor: NodeBorderColor | null,
): TimelineData {
  const node = data.nodes[nodeId];
  if (!node) return data;

  const nextAnnotation = {
    ...(node.annotation ?? {}),
    borderColor: borderColor ?? undefined,
  };
  if (!nextAnnotation.borderColor) {
    delete nextAnnotation.borderColor;
  }

  return {
    ...data,
    nodes: {
      ...data.nodes,
      [nodeId]: {
        ...node,
        annotation: Object.keys(nextAnnotation).length ? nextAnnotation : undefined,
      },
    },
  };
}

function applyNodeDeletion(
  data: TimelineData,
  nodeId: number,
  options: TimelineGraphActionOptions,
): TimelineData {
  const node = data.nodes[nodeId];
  const lockedOpenalexIds = new Set((options.lockedOpenalexIds ?? []).filter(Boolean));
  if (
    !node ||
    nodeId === data.rootId ||
    lockedOpenalexIds.has(node.paper.openalexId) ||
    Object.keys(data.nodes).length <= 1
  ) {
    return data;
  }

  const incomingParentIds = Object.entries(data.adjacency)
    .filter(([, children]) => children.includes(nodeId))
    .map(([fromId]) => Number(fromId))
    .filter((fromId) => fromId !== nodeId && data.nodes[fromId]);
  const outgoingChildIds = (data.adjacency[nodeId] ?? [])
    .filter((childId) => childId !== nodeId && data.nodes[childId]);
  const fallbackParentId = incomingParentIds[0] ?? null;

  const nodes = Object.fromEntries(
    Object.entries(data.nodes)
      .filter(([id]) => Number(id) !== nodeId)
      .map(([id, node]) => {
        const numericId = Number(id);
        const nextNode: TimelineNode = {
          ...node,
          parentId: node.parentId === nodeId ? fallbackParentId : node.parentId,
        };
        return [numericId, nextNode];
      }),
  );

  const adjacency = Object.fromEntries(
    Object.entries(data.adjacency)
      .filter(([fromId]) => Number(fromId) !== nodeId)
      .map(([fromId, children]) => [
        Number(fromId),
        children.filter((childId) => childId !== nodeId && nodes[childId]),
      ]),
  );

  Object.keys(nodes).forEach((id) => {
    const numericId = Number(id);
    if (!adjacency[numericId]) {
      adjacency[numericId] = [];
    }
  });

  const edgeRelations: Record<string, "influenced" | "inferred"> = Object.fromEntries(
    Object.entries(data.edgeRelations ?? {}).filter(([key]) => {
      const [fromId, toId] = key.split("->").map(Number);
      return fromId !== nodeId && toId !== nodeId && nodes[fromId] && nodes[toId];
    }),
  );

  incomingParentIds.forEach((parentId) => {
    if (!nodes[parentId]) return;
    const existingChildren = new Set(adjacency[parentId] ?? []);
    outgoingChildIds.forEach((childId) => {
      if (!nodes[childId] || childId === parentId) return;
      existingChildren.add(childId);
      edgeRelations[edgeKey(parentId, childId)] ??= "inferred";
    });
    adjacency[parentId] = [...existingChildren];
  });

  const affectedNodeIds = new Set<number>();
  outgoingChildIds.forEach((childId) => {
    collectDescendantIds(childId, adjacency, affectedNodeIds);
  });
  affectedNodeIds.forEach((affectedNodeId) => {
    const current = nodes[affectedNodeId];
    if (!current) return;
    const generation = computeGenerationFromParents(affectedNodeId, nodes);
    nodes[affectedNodeId] = {
      ...current,
      generation,
      x: PADDING_X + generation * (NODE_DIMENSIONS.width + GAP_X),
      y: PADDING_Y + current.lane * LANE_HEIGHT,
    };
  });

  const remainingIds = Object.keys(nodes).map(Number).sort((a, b) => a - b);
  const rootId = nodes[data.rootId]
    ? data.rootId
    : remainingIds.find((id) => nodes[id].parentId === null) ?? remainingIds[0];

  return {
    ...data,
    nodes,
    adjacency,
    edgeRelations,
    noteEdges: (data.noteEdges ?? []).filter((edge) => edge.nodeId !== nodeId),
    rootId,
    expansions: data.expansions.filter((expansion) => expansion.sourceNodeId !== nodeId),
  };
}

function edgeKey(fromId: number, toId: number): string {
  return `${fromId}->${toId}`;
}

function applyNoteAddition(
  data: TimelineData,
  action: Extract<TimelineGraphAction, { type: "add_note" }>,
): TimelineData {
  if (!action.note.id) return data;
  const dimensions = estimateTimelineNoteDimensions(action.note.text || "New research note");

  const notes = {
    ...(data.notes ?? {}),
    [action.note.id]: {
      ...action.note,
      text: action.note.text || "New research note",
      width: action.note.width ?? dimensions.width,
      height: action.note.height ?? dimensions.height,
    },
  };
  const noteEdges = [...(data.noteEdges ?? [])];
  if (
    action.connectToNodeId !== null &&
    action.connectToNodeId !== undefined &&
    data.nodes[action.connectToNodeId]
  ) {
    noteEdges.push({
      noteId: action.note.id,
      nodeId: action.connectToNodeId,
      relation: action.relation ?? "about",
    });
  }

  return dedupeNoteEdges({
    ...data,
    notes,
    noteEdges,
  });
}

function applyNoteUpdate(
  data: TimelineData,
  noteId: string,
  patch: Partial<NonNullable<TimelineData["notes"]>[string]>,
): TimelineData {
  const note = data.notes?.[noteId];
  if (!note) return data;

  return {
    ...data,
    notes: {
      ...(data.notes ?? {}),
      [noteId]: {
        ...note,
        ...patch,
        id: noteId,
      },
    },
  };
}

function applyNoteDeletion(data: TimelineData, noteId: string): TimelineData {
  if (!data.notes?.[noteId]) return data;

  const notes = { ...data.notes };
  delete notes[noteId];

  return {
    ...data,
    notes: Object.keys(notes).length ? notes : undefined,
    noteEdges: (data.noteEdges ?? []).filter((edge) => edge.noteId !== noteId),
  };
}

function applyNoteConnection(
  data: TimelineData,
  noteId: string,
  nodeId: number,
  relation: Extract<TimelineGraphAction, { type: "connect_note" }>["relation"],
): TimelineData {
  if (!data.notes?.[noteId] || !data.nodes[nodeId]) return data;

  return dedupeNoteEdges({
    ...data,
    noteEdges: [
      ...(data.noteEdges ?? []),
      { noteId, nodeId, relation: relation ?? "about" },
    ],
  });
}

function applyNoteDisconnection(data: TimelineData, noteId: string, nodeId: number): TimelineData {
  if (!data.notes?.[noteId]) return data;

  return {
    ...data,
    noteEdges: (data.noteEdges ?? []).filter((edge) => edge.noteId !== noteId || edge.nodeId !== nodeId),
  };
}

function dedupeNoteEdges(data: TimelineData): TimelineData {
  const seen = new Set<string>();
  return {
    ...data,
    noteEdges: (data.noteEdges ?? []).filter((edge) => {
      const key = `${edge.noteId}->${edge.nodeId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return Boolean(data.notes?.[edge.noteId] && data.nodes[edge.nodeId]);
    }),
  };
}

function collectDescendantIds(
  nodeId: number,
  adjacency: Record<number, number[]>,
  result: Set<number>,
): void {
  if (result.has(nodeId)) return;
  result.add(nodeId);
  (adjacency[nodeId] ?? []).forEach((childId) => {
    collectDescendantIds(childId, adjacency, result);
  });
}

function computeGenerationFromParents(nodeId: number, nodes: Record<number, TimelineNode>): number {
  const parentId = nodes[nodeId]?.parentId;
  if (parentId === null || parentId === undefined || !nodes[parentId]) {
    return 0;
  }
  return nodes[parentId].generation + 1;
}
