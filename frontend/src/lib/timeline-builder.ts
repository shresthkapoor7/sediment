import { GAP_X, LANE_HEIGHT, NODE_DIMENSIONS, PADDING_X, PADDING_Y } from "./dummy-data";
import { GraphEdge, GraphPaper, LineageGraphResponse, TimelineData, TimelineNode } from "./types";

interface BuildContext {
  paperById: Map<string, GraphPaper>;
  parentsById: Map<string, string[]>;
  childrenById: Map<string, string[]>;
}

interface CanonicalGraph {
  papers: GraphPaper[];
  edges: GraphEdge[];
  aliasesForIds(ids: string[]): string[];
  canonicalIdFor(id: string): string;
}

export function buildTimelineFromGraph(response: LineageGraphResponse): TimelineData {
  const canonical = canonicalizeGraph(response.papers, response.edges);
  return buildTimelineData(canonical.papers, canonical.edges);
}

export function mergeTimelineWithGraph(
  existing: TimelineData,
  fragment: LineageGraphResponse,
  sourceNodeId?: number,
  expansionQuery?: string,
): TimelineData {
  if (!sourceNodeId || !existing.nodes[sourceNodeId]) {
    const canonical = canonicalizeGraph(fragment.papers, fragment.edges);
    return buildTimelineData(canonical.papers, canonical.edges);
  }

  const sourceNode = existing.nodes[sourceNodeId];
  const sourceOpenalexId = sourceNode.paper.openalexId;
  const existingPapers = existingGraphPapers(existing);
  const existingEdges = timelineEdges(existing);

  const canonical = canonicalizeGraph(
    [...existingPapers, ...fragment.papers],
    [...existingEdges, ...fragment.edges],
  );

  const allPapersById = new Map(canonical.papers.map((paper) => [paper.openalexId, paper]));
  const mergedNodes: Record<number, TimelineNode> = cloneNodes(existing.nodes);
  const mergedAdjacency: Record<number, number[]> = cloneAdjacency(existing.adjacency);
  const mergedEdgeRelations = cloneEdgeRelations(existing.edgeRelations);
  const numericIdByOpenalexId = new Map(
    Object.values(mergedNodes).map((node) => [node.paper.openalexId, node.id]),
  );

  const oldMaxGeneration = Math.max(...Object.values(existing.nodes).map((node) => node.generation), 0);
  const fragmentCanonicalIds = new Set(canonical.aliasesForIds(fragment.papers.map((paper) => paper.openalexId)));
  const newLane = existing.lanes;
  const baseX = sourceNode.x - (NODE_DIMENSIONS.width + GAP_X);
  const anchorIds = topologicallyOrderedFragmentIds(canonical, sourceOpenalexId, fragmentCanonicalIds);

  anchorIds.forEach((openalexId, index) => {
    if (!fragmentCanonicalIds.has(openalexId)) {
      return;
    }
    const paper = allPapersById.get(openalexId);
    if (!paper) {
      return;
    }

    const existingNodeId = numericIdByOpenalexId.get(openalexId);
    if (existingNodeId) {
      const existingNode = mergedNodes[existingNodeId];
      mergedNodes[existingNodeId] = {
        ...existingNode,
        paper: mergePaper(existingNode, paper),
        expanded: existingNode.expanded || openalexId === sourceOpenalexId,
      };
      return;
    }

    const newId = nextNumericId(mergedNodes);
    const x = baseX - index * (NODE_DIMENSIONS.width + GAP_X);
    const y = PADDING_Y + newLane * LANE_HEIGHT;

    mergedNodes[newId] = {
      id: newId,
      paper: {
        id: newId,
        openalexId,
        title: paper.title,
        year: paper.year ?? 0,
        summary: paper.summary,
        detail: paper.detail,
        authors: paper.authors ?? [],
        doi: paper.doi,
        oaUrl: paper.oaUrl,
        concepts: paper.concepts ?? [],
        type: paper.type,
      },
      x,
      y,
      lane: newLane,
      parentId: null,
      expanded: false,
      generation: oldMaxGeneration + 1,
    };
    mergedAdjacency[newId] = [];
    numericIdByOpenalexId.set(openalexId, newId);
  });

  canonical.edges.forEach((edge) => {
    const fromId = numericIdByOpenalexId.get(edge.parentOpenalexId);
    const toId = numericIdByOpenalexId.get(edge.childOpenalexId);
    if (!fromId || !toId) return;

    if (!mergedAdjacency[fromId]) {
      mergedAdjacency[fromId] = [];
    }
    if (!mergedAdjacency[fromId].includes(toId)) {
      mergedAdjacency[fromId].push(toId);
    }
    const relationKey = edgeKey(fromId, toId);
    mergedEdgeRelations[relationKey] = strongerRelation(
      mergedEdgeRelations[relationKey],
      edge.relation,
    );

    const childNode = mergedNodes[toId];
    const parentNode = mergedNodes[fromId];
    if (childNode && childNode.parentId === null && childNode.id !== sourceNodeId) {
      mergedNodes[toId] = {
        ...childNode,
        parentId: parentNode.id,
      };
    }
  });

  const canonicalSourceId = canonical.canonicalIdFor(sourceOpenalexId);
  const mergedSourceNodeId = numericIdByOpenalexId.get(canonicalSourceId) ?? sourceNodeId;
  mergedNodes[mergedSourceNodeId] = {
    ...mergedNodes[mergedSourceNodeId],
    expanded: true,
  };

  return {
    nodes: mergedNodes,
    adjacency: mergedAdjacency,
    edgeRelations: mergedEdgeRelations,
    lanes: Math.max(existing.lanes, newLane + 1),
    rootId: existing.rootId,
    expansions: expansionQuery
      ? [
          ...existing.expansions,
          { sourceNodeId: mergedSourceNodeId, query: expansionQuery, lane: newLane },
        ]
      : [...existing.expansions],
  };
}

function buildTimelineData(papers: GraphPaper[], edges: GraphEdge[]): TimelineData {
  const paperById = new Map(papers.map((paper) => [paper.openalexId, paper]));
  const parentsById = buildParentsMap(edges);
  const childrenById = buildChildrenMap(edges);
  const context: BuildContext = { paperById, parentsById, childrenById };

  const orderedIds = [...paperById.keys()].sort((a, b) => comparePapers(paperById.get(a), paperById.get(b)));
  const numericIdByOpenalexId = new Map<string, number>();
  const openalexIdByNumericId = new Map<number, string>();
  const nodes: Record<number, TimelineNode> = {};
  const adjacency: Record<number, number[]> = {};
  const edgeRelations: Record<string, GraphEdge["relation"]> = {};
  const memoDepth = new Map<string, number>();
  const nextRootLane = { value: 0 };
  const occupiedLanesByColumn = new Map<number, Set<number>>();

  orderedIds.forEach((openalexId, index) => {
    const numericId = index + 1;
    numericIdByOpenalexId.set(openalexId, numericId);
    openalexIdByNumericId.set(numericId, openalexId);
  });

  orderedIds.forEach((openalexId, index) => {
    const paper = paperById.get(openalexId);
    if (!paper) return;

    const generation = getDepth(openalexId, context, memoDepth);
    const preferredParentId = parentsById.get(openalexId)?.[0] ?? null;
    const preferredLane = preferredParentId
      ? nodes[numericIdByOpenalexId.get(preferredParentId) ?? -1]?.lane ?? nextRootLane.value
      : nextRootLane.value++;
    const lane = assignLane(index, preferredLane, occupiedLanesByColumn);

    const numericId = numericIdByOpenalexId.get(openalexId)!;
    nodes[numericId] = {
      id: numericId,
      paper: {
        id: numericId,
        openalexId,
        title: paper.title,
        year: paper.year ?? 0,
        summary: paper.summary,
        detail: paper.detail,
        authors: paper.authors ?? [],
        doi: paper.doi,
        oaUrl: paper.oaUrl,
        concepts: paper.concepts ?? [],
        type: paper.type,
      },
      x: PADDING_X + generation * (NODE_DIMENSIONS.width + GAP_X),
      y: PADDING_Y + lane * LANE_HEIGHT,
      lane,
      parentId: preferredParentId ? numericIdByOpenalexId.get(preferredParentId) ?? null : null,
      expanded: false,
      generation,
    };
    adjacency[numericId] = [];
  });

  edges.forEach((edge) => {
    const fromId = numericIdByOpenalexId.get(edge.parentOpenalexId);
    const toId = numericIdByOpenalexId.get(edge.childOpenalexId);
    if (!fromId || !toId) return;
    adjacency[fromId].push(toId);
    edgeRelations[edgeKey(fromId, toId)] = edge.relation;
  });

  Object.values(adjacency).forEach((children) => children.sort((a, b) => comparePapers(
    paperById.get(openalexIdByNumericId.get(a)!),
    paperById.get(openalexIdByNumericId.get(b)!),
  )));

  const rootOpenalexId = orderedIds.find((id) => !(parentsById.get(id)?.length)) ?? orderedIds[0];
  const rootId = numericIdByOpenalexId.get(rootOpenalexId) ?? 1;
  const lanes = Math.max(...Object.values(nodes).map((node) => node.lane), 0) + 1;

  return {
    nodes,
    adjacency,
    edgeRelations,
    lanes,
    rootId,
    expansions: [],
  };
}

function canonicalizeGraph(papers: GraphPaper[], edges: GraphEdge[]): CanonicalGraph {
  const canonicalByKey = new Map<string, GraphPaper>();
  const aliasToCanonical = new Map<string, string>();

  papers.forEach((paper) => {
    const key = paperIdentityKey(paper);
    const current = canonicalByKey.get(key);
    if (!current) {
      canonicalByKey.set(key, paper);
      aliasToCanonical.set(paper.openalexId, paper.openalexId);
      return;
    }

    const preferred = preferPaper(current, paper);
    canonicalByKey.set(key, preferred);
    const canonicalId = preferred.openalexId;
    aliasToCanonical.set(current.openalexId, canonicalId);
    aliasToCanonical.set(paper.openalexId, canonicalId);
  });

  canonicalByKey.forEach((paper) => {
    aliasToCanonical.set(paper.openalexId, paper.openalexId);
  });

  const dedupedEdges = new Map<string, GraphEdge>();
  edges.forEach((edge) => {
    const parentOpenalexId = aliasToCanonical.get(edge.parentOpenalexId) ?? edge.parentOpenalexId;
    const childOpenalexId = aliasToCanonical.get(edge.childOpenalexId) ?? edge.childOpenalexId;
    if (parentOpenalexId === childOpenalexId) return;
    const key = `${parentOpenalexId}->${childOpenalexId}`;
    const existing = dedupedEdges.get(key);
    const relation = strongerRelation(existing?.relation, edge.relation);
    dedupedEdges.set(key, {
      parentOpenalexId,
      childOpenalexId,
      relation,
    });
  });

  return {
    papers: [...new Map(
      [...canonicalByKey.values()].map((paper) => [paper.openalexId, paper]),
    ).values()],
    edges: [...dedupedEdges.values()],
    aliasesForIds(ids: string[]) {
      return ids.map((id) => aliasToCanonical.get(id) ?? id);
    },
    canonicalIdFor(id: string) {
      return aliasToCanonical.get(id) ?? id;
    },
  };
}

function existingGraphPapers(data: TimelineData): GraphPaper[] {
  return Object.values(data.nodes).map((node) => ({
    openalexId: node.paper.openalexId,
    title: node.paper.title,
    year: node.paper.year,
    summary: node.paper.summary,
    detail: node.paper.detail,
    authors: node.paper.authors ?? [],
    doi: node.paper.doi ?? null,
    oaUrl: node.paper.oaUrl ?? null,
    concepts: node.paper.concepts ?? [],
    type: node.paper.type ?? null,
  }));
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

function cloneEdgeRelations(
  edgeRelations?: Record<string, GraphEdge["relation"]>,
): Record<string, GraphEdge["relation"]> {
  return { ...(edgeRelations ?? {}) };
}

function topologicallyOrderedFragmentIds(
  canonical: CanonicalGraph,
  sourceOpenalexId: string,
  fragmentIds: Set<string>,
): string[] {
  const sourceCanonicalId = canonical.canonicalIdFor(sourceOpenalexId);
  const paperById = new Map(canonical.papers.map((paper) => [paper.openalexId, paper]));
  const parentsById = buildParentsMap(canonical.edges);
  const relevantIds = [...fragmentIds].filter((id) => id !== sourceCanonicalId);

  return relevantIds.sort((a, b) => {
    const depthA = ancestorDistance(a, sourceCanonicalId, parentsById);
    const depthB = ancestorDistance(b, sourceCanonicalId, parentsById);
    if (depthA !== depthB) return depthA - depthB;
    return comparePapersDescending(paperById.get(a), paperById.get(b));
  });
}

function ancestorDistance(
  startId: string,
  targetId: string,
  parentsById: Map<string, string[]>,
): number {
  if (startId === targetId) return 0;
  const queue: Array<{ id: string; dist: number }> = [{ id: startId, dist: 0 }];
  const seen = new Set<string>([startId]);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const children = parentsById.get(current.id) ?? [];
    for (const childId of children) {
      if (childId === targetId) {
        return current.dist + 1;
      }
      if (!seen.has(childId)) {
        seen.add(childId);
        queue.push({ id: childId, dist: current.dist + 1 });
      }
    }
  }

  return 9999;
}

function mergePaper(node: TimelineNode, paper: GraphPaper): TimelineNode["paper"] {
  return {
    ...node.paper,
    title: paper.title || node.paper.title,
    year: paper.year ?? node.paper.year,
    summary: paper.summary || node.paper.summary,
    detail: paper.detail || node.paper.detail,
    authors: (paper.authors && paper.authors.length > 0) ? paper.authors : node.paper.authors,
    doi: paper.doi ?? node.paper.doi,
    oaUrl: paper.oaUrl ?? node.paper.oaUrl,
    concepts: (paper.concepts && paper.concepts.length > 0) ? paper.concepts : node.paper.concepts,
    type: paper.type ?? node.paper.type,
  };
}

function nextNumericId(nodes: Record<number, TimelineNode>): number {
  return Math.max(0, ...Object.keys(nodes).map(Number)) + 1;
}

function paperIdentityKey(paper: GraphPaper): string {
  const doi = normalizeDoi(paper.doi ?? null);
  if (doi) {
    return `doi:${doi}`;
  }
  return `title:${normalizeTitle(paper.title)}::${paper.year ?? "unknown"}`;
}

function normalizeDoi(doi: string | null): string {
  if (!doi) return "";
  return doi
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//, "");
}

function normalizeTitle(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ");
}

function preferPaper(current: GraphPaper, candidate: GraphPaper): GraphPaper {
  const currentScore = paperQualityScore(current);
  const candidateScore = paperQualityScore(candidate);
  const winner = candidateScore > currentScore ? candidate : current;
  const loser = winner === candidate ? current : candidate;
  return {
    ...winner,
    oaUrl: winner.oaUrl ?? loser.oaUrl,
    concepts: (winner.concepts?.length ?? 0) > 0 ? winner.concepts : loser.concepts,
    type: winner.type ?? loser.type,
  };
}

function paperQualityScore(paper: GraphPaper): number {
  return (
    (paper.summary ? 4 : 0) +
    ((paper.authors?.length ?? 0) > 0 ? 2 : 0) +
    (paper.doi ? 2 : 0) +
    (paper.year ? 1 : 0)
  );
}

function timelineEdges(data: TimelineData): GraphEdge[] {
  return Object.entries(data.adjacency).flatMap(([fromId, children]) => {
    const fromNumericId = Number(fromId);
    const fromNode = data.nodes[fromNumericId];
    if (!fromNode) return [];
    return children.flatMap((toId) => {
      const toNode = data.nodes[toId];
      if (!toNode) return [];
      return [{
        parentOpenalexId: fromNode.paper.openalexId,
        childOpenalexId: toNode.paper.openalexId,
        relation: data.edgeRelations?.[edgeKey(fromNumericId, toId)] ?? "influenced",
      }];
    });
  });
}

function edgeKey(fromId: number, toId: number): string {
  return `${fromId}->${toId}`;
}

function strongerRelation(
  current: GraphEdge["relation"] | undefined,
  incoming: GraphEdge["relation"],
): GraphEdge["relation"] {
  if (current === "influenced" || incoming === "influenced") {
    return "influenced";
  }
  return incoming;
}

function buildParentsMap(edges: GraphEdge[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  edges.forEach(({ parentOpenalexId, childOpenalexId }) => {
    if (!map.has(childOpenalexId)) {
      map.set(childOpenalexId, []);
    }
    map.get(childOpenalexId)!.push(parentOpenalexId);
  });
  return map;
}

function buildChildrenMap(edges: GraphEdge[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  edges.forEach(({ parentOpenalexId, childOpenalexId }) => {
    if (!map.has(parentOpenalexId)) {
      map.set(parentOpenalexId, []);
    }
    map.get(parentOpenalexId)!.push(childOpenalexId);
  });
  return map;
}

function comparePapers(a?: GraphPaper, b?: GraphPaper): number {
  const yearA = a?.year ?? 9999;
  const yearB = b?.year ?? 9999;
  if (yearA !== yearB) return yearA - yearB;
  return (a?.title ?? "").localeCompare(b?.title ?? "");
}

function comparePapersDescending(a?: GraphPaper, b?: GraphPaper): number {
  const yearA = a?.year ?? -9999;
  const yearB = b?.year ?? -9999;
  if (yearA !== yearB) return yearB - yearA;
  return (a?.title ?? "").localeCompare(b?.title ?? "");
}

function getDepth(openalexId: string, context: BuildContext, memo: Map<string, number>, visiting: Set<string> = new Set()): number {
  if (memo.has(openalexId)) {
    return memo.get(openalexId)!;
  }
  if (visiting.has(openalexId)) {
    // Cycle detected — break it by returning 0
    memo.set(openalexId, 0);
    return 0;
  }
  const parents = context.parentsById.get(openalexId) ?? [];
  if (parents.length === 0) {
    memo.set(openalexId, 0);
    return 0;
  }
  visiting.add(openalexId);
  const depth = Math.max(...parents.map((parentId) => getDepth(parentId, context, memo, visiting))) + 1;
  visiting.delete(openalexId);
  memo.set(openalexId, depth);
  return depth;
}

function assignLane(column: number, preferredLane: number, occupiedByColumn: Map<number, Set<number>>): number {
  if (!occupiedByColumn.has(column)) {
    occupiedByColumn.set(column, new Set());
  }
  const occupied = occupiedByColumn.get(column)!;
  let lane = Math.max(0, preferredLane);
  while (occupied.has(lane)) {
    lane += 1;
  }
  occupied.add(lane);
  return lane;
}
