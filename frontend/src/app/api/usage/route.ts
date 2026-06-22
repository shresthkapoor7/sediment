import { NextRequest } from "next/server";

import { proxyGetRequest } from "../_lib/backend-proxy";

export async function GET(request: NextRequest) {
  return proxyGetRequest(request, "/api/usage");
}
