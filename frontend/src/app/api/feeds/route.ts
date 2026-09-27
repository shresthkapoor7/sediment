import { NextRequest } from "next/server";
import { proxyGetRequest, proxyJsonRequest } from "../_lib/backend-proxy";

export const maxDuration = 180;
export function GET(request: NextRequest) { return proxyGetRequest(request, "/api/feeds"); }
export function POST(request: NextRequest) { return proxyJsonRequest(request, "/api/feeds"); }
