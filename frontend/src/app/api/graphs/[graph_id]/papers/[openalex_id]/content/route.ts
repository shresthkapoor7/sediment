import { NextRequest } from "next/server";

import { proxyGetRequest } from "../../../../../_lib/backend-proxy";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ graph_id: string; openalex_id: string }> },
) {
  const { graph_id: graphId, openalex_id: openalexId } = await context.params;
  return proxyGetRequest(
    request,
    `/api/graphs/${encodeURIComponent(graphId)}/papers/${encodeURIComponent(openalexId)}/content`,
  );
}
