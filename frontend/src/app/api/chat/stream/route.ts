import { NextRequest } from "next/server";

import { proxyJsonRequest } from "../../_lib/backend-proxy";

export async function POST(request: NextRequest) {
  return proxyJsonRequest(request, "/api/chat/stream");
}
