import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getBackendBaseUrl } from "@/app/api/_lib/backend-proxy";
import type { CanvasOp } from "@/lib/canvas-ops";
import { commitCanvasOps } from "@/lib/server/canvas-commit";
import { createEmptyTimeline } from "@/lib/timeline-builder";
import type { GraphPaper, TimelineData, TimelineNoteKind } from "@/lib/types";

/**
 * Sediment's MCP tools. Every call runs as the signed-in account behind the OAuth token: reads go to FastAPI with
 * that token, and canvas edits go through the same operations as the app (logged `via: mcp`). Papers are named by
 * OpenAlex ID throughout, the same way the in-app agent names them.
 */
type Text = { content: { type: "text"; text: string }[]; isError?: boolean };
const text = (value: unknown): Text => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] });
const failure = (message: string): Text => ({ ...text(message), isError: true });

const NOTE_KINDS = ["field_note", "question", "insight", "todo", "contradiction"] as const;

/** What an agent needs to work with a canvas, without layout coordinates. */
function summarize(id: string, title: string, data: TimelineData) {
  const nodes = Object.values(data.nodes);
  const byNumeric = new Map(nodes.map((node) => [node.id, node.paper.openalexId]));
  return {
    id,
    title,
    papers: nodes.map((node) => ({
      openalexId: node.paper.openalexId, title: node.paper.title, year: node.paper.year,
      authors: (node.paper.authors ?? []).slice(0, 4), cluster: node.group ?? null,
    })),
    links: Object.entries(data.adjacency).flatMap(([parent, children]) => children.map((child) => ({
      from: byNumeric.get(Number(parent)), to: byNumeric.get(child),
      relation: data.edgeRelations?.[`${parent}-${child}`] ?? "influenced",
    }))),
    notes: Object.values(data.notes ?? {}).map((note) => ({
      id: note.id, kind: note.kind ?? "field_note", text: note.text,
      about: (data.noteEdges ?? []).filter((edge) => edge.noteId === note.id).map((edge) => byNumeric.get(edge.nodeId)),
    })),
  };
}

export function createSedimentMcpServer(token: string): McpServer {
  const server = new McpServer({ name: "sediment", version: "0.1.0" });
  const identity = { Authorization: `Bearer ${token}` };
  const api = async (path: string, init: RequestInit = {}) => {
    const response = await fetch(`${getBackendBaseUrl()}/api${path}`, {
      ...init, cache: "no-store",
      headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...identity, ...(init.headers ?? {}) },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error((body as { detail?: string }).detail || `Sediment returned ${response.status}`);
    return body;
  };
  const edit = async (canvasId: string, ops: CanvasOp[]) => {
    const result = await commitCanvasOps(canvasId, ops, "mcp", identity);
    if (!result.ok) throw new Error(result.detail);
    return result;
  };
  const run = (fn: () => Promise<Text>) => fn().catch((error: unknown) => failure(error instanceof Error ? error.message : String(error)));
  const lookupPapers = async (ids: string[]) => {
    const papers: GraphPaper[] = [];
    for (const id of ids) {
      const found = await api(`/papers/search?q=${encodeURIComponent(id)}&limit=1`) as GraphPaper[];
      if (found[0]) papers.push(found[0]);
    }
    return papers;
  };

  server.registerTool("search_papers", {
    title: "Search papers",
    description: "Search OpenAlex for papers by topic, title, DOI or OpenAlex ID. Returns OpenAlex IDs to use with the canvas tools.",
    inputSchema: { query: z.string().min(2), limit: z.number().int().min(1).max(20).optional(), semantic: z.boolean().optional() },
    annotations: { readOnlyHint: true },
  }, ({ query, limit, semantic }) => run(async () => {
    const papers = await api(`/papers/search?q=${encodeURIComponent(query)}&limit=${limit ?? 10}&mode=${semantic ? "semantic" : "keyword"}`) as GraphPaper[];
    return text(papers.map((paper) => ({
      openalexId: paper.openalexId, title: paper.title, year: paper.year, authors: (paper.authors ?? []).slice(0, 4),
      citedByCount: paper.citedByCount, summary: paper.summary,
    })));
  }));

  server.registerTool("list_canvases", {
    title: "List canvases",
    description: "The signed-in researcher's canvases, newest first.",
    inputSchema: { limit: z.number().int().min(1).max(50).optional() },
    annotations: { readOnlyHint: true },
  }, ({ limit }) => run(async () => {
    const list = await api(`/graphs?limit=${limit ?? 20}`) as { items: { id: string; query: string; metadata: { title?: string; nodeCount?: number }; updatedAt: string }[] };
    return text(list.items.map((item) => ({ id: item.id, title: item.metadata.title || item.query, papers: item.metadata.nodeCount ?? 0, updatedAt: item.updatedAt })));
  }));

  server.registerTool("get_canvas", {
    title: "Read a canvas",
    description: "A canvas's papers (with clusters), the links between them, and its notes.",
    inputSchema: { canvasId: z.string() },
    annotations: { readOnlyHint: true },
  }, ({ canvasId }) => run(async () => {
    const graph = await api(`/graphs/${encodeURIComponent(canvasId)}`) as { id: string; query: string; data: TimelineData; metadata: { title?: string } };
    return text(summarize(graph.id, graph.metadata.title || graph.query, graph.data));
  }));

  server.registerTool("create_canvas", {
    title: "Create a canvas",
    description: "Start a new, empty canvas. Add papers to it with add_papers.",
    inputSchema: { title: z.string().min(1).max(120) },
  }, ({ title }) => run(async () => {
    const data = createEmptyTimeline();
    const graph = await api("/graphs", {
      method: "POST",
      body: JSON.stringify({ userId: "-", query: title, data, metadata: { title, description: "", titleSetBy: "agent", descriptionSetBy: null, nodeCount: 0 } }),
    }) as { id: string };
    return text({ canvasId: graph.id, title });
  }));

  server.registerTool("add_papers", {
    title: "Add papers",
    description: "Add papers to a canvas by OpenAlex ID, optionally linking them (from = earlier/influencing paper, to = later) and putting them in a cluster.",
    inputSchema: {
      canvasId: z.string(),
      openalexIds: z.array(z.string()).min(1).max(20),
      links: z.array(z.object({ from: z.string(), to: z.string(), relation: z.enum(["influenced", "inferred"]).optional() })).max(40).optional(),
      cluster: z.string().max(60).optional(),
    },
  }, ({ canvasId, openalexIds, links, cluster }) => run(async () => {
    const papers = await lookupPapers(openalexIds);
    const result = await edit(canvasId, [{
      type: "lineage_changes",
      changes: [{
        addedPapers: papers,
        removedPaperIds: [],
        edges: (links ?? []).map((link) => ({ parentOpenalexId: link.from, childOpenalexId: link.to, relation: link.relation ?? "influenced" })),
        groups: cluster ? [{ label: cluster, paperIds: papers.map((paper) => paper.openalexId) }] : undefined,
      }],
    }]);
    return text({ added: papers.map((paper) => paper.title), notFound: openalexIds.length - papers.length, papersOnCanvas: Object.keys(result.data.nodes).length });
  }));

  server.registerTool("link_papers", {
    title: "Link papers",
    description: "Draw lineage links between papers already on the canvas (from = influencing paper, to = influenced).",
    inputSchema: { canvasId: z.string(), links: z.array(z.object({ from: z.string(), to: z.string(), relation: z.enum(["influenced", "inferred"]).optional() })).min(1).max(40) },
  }, ({ canvasId, links }) => run(async () => {
    const result = await edit(canvasId, [{
      type: "lineage_changes",
      changes: [{ addedPapers: [], removedPaperIds: [], edges: links.map((link) => ({ parentOpenalexId: link.from, childOpenalexId: link.to, relation: link.relation ?? "influenced" })) }],
    }]);
    return text({ changed: result.changed });
  }));

  server.registerTool("remove_papers", {
    title: "Remove papers",
    description: "Take papers off a canvas by OpenAlex ID.",
    inputSchema: { canvasId: z.string(), openalexIds: z.array(z.string()).min(1).max(40) },
    annotations: { destructiveHint: true },
  }, ({ canvasId, openalexIds }) => run(async () => {
    const result = await edit(canvasId, [{ type: "lineage_changes", changes: [{ addedPapers: [], removedPaperIds: openalexIds, edges: [] }] }]);
    return text({ changed: result.changed, papersOnCanvas: Object.keys(result.data.nodes).length });
  }));

  server.registerTool("set_cluster", {
    title: "Cluster papers",
    description: "Put papers into a named cluster (a labelled region on the canvas). Pass cluster null to take them out.",
    inputSchema: { canvasId: z.string(), openalexIds: z.array(z.string()).min(1).max(40), cluster: z.string().max(60).nullable() },
  }, ({ canvasId, openalexIds, cluster }) => run(async () => {
    const graph = await api(`/graphs/${encodeURIComponent(canvasId)}`) as { data: TimelineData };
    const wanted = new Set(openalexIds.map((id) => id.toUpperCase().replace(/^HTTPS:\/\/OPENALEX\.ORG\//, "")));
    const ops: CanvasOp[] = Object.values(graph.data.nodes)
      .filter((node) => wanted.has(node.paper.openalexId.toUpperCase().replace(/^HTTPS:\/\/OPENALEX\.ORG\//, "")))
      .map((node) => ({ type: "set_node_group", nodeId: node.id, group: cluster }));
    if (!ops.length) return failure("None of those papers are on this canvas.");
    await edit(canvasId, ops);
    return text({ clustered: ops.length, cluster });
  }));

  server.registerTool("add_note", {
    title: "Add a note",
    description: "Add a note to a canvas, optionally attached to papers on it.",
    inputSchema: {
      canvasId: z.string(), text: z.string().min(1).max(4000),
      kind: z.enum(NOTE_KINDS).optional(), aboutOpenalexIds: z.array(z.string()).max(10).optional(),
    },
  }, ({ canvasId, text: body, kind, aboutOpenalexIds }) => run(async () => {
    const noteId = crypto.randomUUID();
    await edit(canvasId, [{
      type: "note_changes",
      changes: [{
        createdNotes: [{ id: noteId, text: body, kind: (kind ?? "field_note") as TimelineNoteKind }],
        updatedNotes: [], deletedNoteIds: [], disconnections: [],
        connections: (aboutOpenalexIds ?? []).map((paperId) => ({ noteId, paperId, relation: "about" as const })),
      }],
    }]);
    return text({ noteId });
  }));

  return server;
}
