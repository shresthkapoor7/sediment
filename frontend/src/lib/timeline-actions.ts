import { NodeBorderColor, TimelineData, TimelineGraphAction, TimelineNode } from "./types";
import { GAP_X, LANE_HEIGHT, NODE_DIMENSIONS, PADDING_X, PADDING_Y } from "./dummy-data";

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
    rootId,
    expansions: data.expansions.filter((expansion) => expansion.sourceNodeId !== nodeId),
  };
}

function edgeKey(fromId: number, toId: number): string {
  return `${fromId}->${toId}`;
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
