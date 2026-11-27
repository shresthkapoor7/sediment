import { NextRequest, NextResponse } from "next/server";

import { getBackendBaseUrl, identityHeaders } from "../../../_lib/backend-proxy";
import { applyCanvasOps, isCanvasOp, MAX_OPS_PER_COMMIT, type CanvasOp, type CanvasOpSource } from "@/lib/canvas-ops";
import type { TimelineData } from "@/lib/types";

// Each attempt reads the canvas, applies the ops and commits against the version it read. A 409 means another
// writer got in between, so read again and re-apply: ops are intent ("move paper 3 here"), not a snapshot.
const MAX_ATTEMPTS = 4;
const NO_STORE = { "Cache-Control": "no-store" };

function error(detail: string, status: number) {
  return NextResponse.json({ detail }, { status, headers: NO_STORE });
}

export async function POST(request: NextRequest, context: { params: Promise<{ graph_id: string }> }) {
  const { graph_id: graphId } = await context.params;
  let body: { ops?: unknown; via?: unknown };
  try { body = await request.json(); } catch { return error("Invalid JSON.", 400); }

  const ops = body.ops;
  if (!Array.isArray(ops) || ops.length === 0 || ops.length > MAX_OPS_PER_COMMIT || !ops.every(isCanvasOp)) {
    return error(`ops must be 1 to ${MAX_OPS_PER_COMMIT} canvas operations.`, 400);
  }
  const via: CanvasOpSource = body.via === "agent" || body.via === "mcp" ? body.via : "ui";

  const base = `${getBackendBaseUrl()}/api/graphs/${encodeURIComponent(graphId)}`;
  const identity = identityHeaders(request);

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const current = await fetch(base, { headers: identity, cache: "no-store" }).catch(() => null);
    if (!current) return error("Backend service is unavailable.", 502);
    if (!current.ok) return new NextResponse(current.body, { status: current.status, headers: NO_STORE });
    const graph = await current.json() as { data: TimelineData; version: number };

    const data = applyCanvasOps(graph.data, ops as CanvasOp[]);
    if (data === graph.data) return NextResponse.json({ version: graph.version, data, changed: false }, { headers: NO_STORE });

    const commit = await fetch(`${base}/ops/commit`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...identity },
      body: JSON.stringify({ baseVersion: graph.version, data, ops, via }),
      cache: "no-store",
    }).catch(() => null);
    if (!commit) return error("Backend service is unavailable.", 502);
    if (commit.status === 409) continue;
    if (!commit.ok) return new NextResponse(commit.body, { status: commit.status, headers: NO_STORE });
    const { version } = await commit.json() as { version: number };
    return NextResponse.json({ version, data, changed: true }, { headers: NO_STORE });
  }
  return error("The canvas is changing too quickly; try again.", 409);
}
