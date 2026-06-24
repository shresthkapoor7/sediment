import { NodeBorderColor, TimelineData, TimelineGraphAction, TimelineNode } from "./types";

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
    return applyNoteAddition(data, action);
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

  const notes = {
    ...(data.notes ?? {}),
    [action.note.id]: {
      ...action.note,
      text: action.note.text || "New research note",
    },
  };
  const noteEdges = [...(data.noteEdges ?? [])];
  if (action.connectToNodeId && data.nodes[action.connectToNodeId]) {
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
