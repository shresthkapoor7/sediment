import { NextRequest, NextResponse } from "next/server";

import { identityHeaders } from "../../../_lib/backend-proxy";
import { isCanvasOp, MAX_OPS_PER_COMMIT, type CanvasOp, type CanvasOpSource } from "@/lib/canvas-ops";
import { commitCanvasOps } from "@/lib/server/canvas-commit";

const NO_STORE = { "Cache-Control": "no-store" };

/** Canvas edits from the app. The canvas page sends `ui` and `agent`; MCP clients go through /api/mcp instead. */
export async function POST(request: NextRequest, context: { params: Promise<{ graph_id: string }> }) {
  const { graph_id: graphId } = await context.params;
  let body: { ops?: unknown; via?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ detail: "Invalid JSON." }, { status: 400, headers: NO_STORE }); }

  const ops = body.ops;
  if (!Array.isArray(ops) || ops.length === 0 || ops.length > MAX_OPS_PER_COMMIT || !ops.every(isCanvasOp)) {
    return NextResponse.json({ detail: `ops must be 1 to ${MAX_OPS_PER_COMMIT} canvas operations.` }, { status: 400, headers: NO_STORE });
  }
  const via: CanvasOpSource = body.via === "agent" ? "agent" : "ui";

  const result = await commitCanvasOps(graphId, ops as CanvasOp[], via, identityHeaders(request));
  if (!result.ok) return NextResponse.json({ detail: result.detail }, { status: result.status, headers: NO_STORE });
  return NextResponse.json({ version: result.version, data: result.data, changed: result.changed }, { headers: NO_STORE });
}
