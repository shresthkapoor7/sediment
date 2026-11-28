import { getBackendBaseUrl } from "@/app/api/_lib/backend-proxy";
import { applyCanvasOps, loadCanvasData, type CanvasOp, type CanvasOpSource } from "@/lib/canvas-ops";
import type { TimelineData } from "@/lib/types";

// Each attempt reads the canvas, applies the ops and commits against the version it read. A 409 means another
// writer got in between, so read again and re-apply: ops are intent ("move paper 3 here"), not a snapshot.
const MAX_ATTEMPTS = 4;

export type CommitResult =
  | { ok: true; version: number; data: TimelineData; changed: boolean }
  | { ok: false; status: number; detail: string };

async function detailOf(response: Response): Promise<string> {
  try { return ((await response.json()) as { detail?: string }).detail || response.statusText; } catch { return response.statusText; }
}

/** Applies canvas operations on the server as the caller identified by `identity` (forwarded to FastAPI). */
export async function commitCanvasOps(
  graphId: string, ops: CanvasOp[], via: CanvasOpSource, identity: Record<string, string>, batchId?: string,
): Promise<CommitResult> {
  // A batch id makes the commit safe to resend: the server stores each batch once. Callers that don't resend
  // (MCP tools) still get one, so a retry after a lost commit response here can't apply the ops twice either.
  const id = batchId ?? crypto.randomUUID();
  const base = `${getBackendBaseUrl()}/api/graphs/${encodeURIComponent(graphId)}`;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const current = await fetch(base, { headers: identity, cache: "no-store" }).catch(() => null);
    if (!current) return { ok: false, status: 502, detail: "Backend service is unavailable." };
    if (!current.ok) return { ok: false, status: current.status, detail: await detailOf(current) };
    const graph = await current.json() as { data: TimelineData; version: number };

    const loaded = loadCanvasData(graph.data);
    const data = applyCanvasOps(loaded, ops);
    if (data === loaded) return { ok: true, version: graph.version, data, changed: false };

    const commit = await fetch(`${base}/ops/commit`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...identity },
      body: JSON.stringify({ baseVersion: graph.version, data, ops, via, batchId: id }),
      cache: "no-store",
    }).catch(() => null);
    if (!commit) return { ok: false, status: 502, detail: "Backend service is unavailable." };
    if (commit.status === 409) continue;
    if (!commit.ok) return { ok: false, status: commit.status, detail: await detailOf(commit) };
    const { version, duplicate } = await commit.json() as { version: number; duplicate?: boolean };
    // Already stored by an earlier send: what was read is the server's state, ops included.
    if (duplicate) return { ok: true, version: graph.version, data: loaded, changed: false };
    return { ok: true, version, data, changed: true };
  }
  return { ok: false, status: 409, detail: "The canvas is changing too quickly; try again." };
}
