import { NextRequest } from "next/server";
import { proxyJsonRequest } from "../_lib/backend-proxy";

export function POST(request: NextRequest) { return proxyJsonRequest(request, "/api/feed-session"); }
