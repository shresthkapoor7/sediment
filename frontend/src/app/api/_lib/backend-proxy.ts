import { NextRequest, NextResponse } from "next/server";

const DEFAULT_BACKEND_URL = "http://127.0.0.1:8000";

function getBackendBaseUrl(): string {
  return (
    process.env.BACKEND_INTERNAL_URL
    || process.env.RAILWAY_API_URL
    || process.env.NEXT_PUBLIC_API_URL
    || DEFAULT_BACKEND_URL
  ).replace(/\/+$/, "");
}

function getBackendUrl(pathname: string, search: string): string {
  return `${getBackendBaseUrl()}${pathname}${search}`;
}

export async function proxyJsonRequest(request: NextRequest, backendPath: string): Promise<NextResponse> {
  const body = await request.text();
  const upstreamResponse = await fetch(getBackendUrl(backendPath, request.nextUrl.search), {
    method: request.method,
    headers: {
      "Content-Type": request.headers.get("content-type") || "application/json",
    },
    body,
    cache: "no-store",
  });

  return new NextResponse(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: {
      "Content-Type": upstreamResponse.headers.get("content-type") || "application/json",
      "Cache-Control": "no-store",
    },
  });
}

export async function proxyGetRequest(request: NextRequest, backendPath: string): Promise<NextResponse> {
  const upstreamResponse = await fetch(getBackendUrl(backendPath, request.nextUrl.search), {
    method: request.method,
    cache: "no-store",
  });

  return new NextResponse(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: {
      "Content-Type": upstreamResponse.headers.get("content-type") || "application/json",
      "Cache-Control": "no-store",
    },
  });
}
