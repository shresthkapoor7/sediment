import { NextRequest } from "next/server";

import { proxyGetRequest } from "../../../_lib/backend-proxy";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ openalex_id: string }> },
) {
  const { openalex_id: openalexId } = await context.params;
  return proxyGetRequest(request, `/api/papers/${encodeURIComponent(openalexId)}/access`);
}
