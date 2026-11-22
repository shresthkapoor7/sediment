import { NextRequest, NextResponse } from "next/server";

const DEFAULT_BACKEND_URL = "http://127.0.0.1:8000";

export function getBackendBaseUrl(): string {
  const candidate = (
    process.env.BACKEND_INTERNAL_URL
    || process.env.RAILWAY_API_URL
    || process.env.NEXT_PUBLIC_API_URL
    || DEFAULT_BACKEND_URL
  ).replace(/\/+$/, "");

  if (
    process.env.NODE_ENV !== "development"
    && (candidate === DEFAULT_BACKEND_URL || /^https?:\/\/(localhost|127\.0\.0\.1)(?::\d+)?$/i.test(candidate))
  ) {
    throw new Error("No backend target is configured for the API proxy.");
  }

  return candidate;
}

/** Pass the caller's identity through: the account token, the anonymous browser ID and the feed credential. */
const IDENTITY_HEADERS = { authorization: "Authorization", "x-sediment-user": "X-Sediment-User", "x-sediment-feed": "X-Sediment-Feed" };
function identityHeaders(request: NextRequest): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [incoming, outgoing] of Object.entries(IDENTITY_HEADERS)) {
    const value = request.headers.get(incoming);
    if (value) headers[outgoing] = value;
  }
  return headers;
}

function getBackendUrl(pathname: string, search: string): string {
  return `${getBackendBaseUrl()}${pathname}${search}`;
}

export async function proxyJsonRequest(request: NextRequest, backendPath: string): Promise<NextResponse> {
  const body = await request.text();
  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(getBackendUrl(backendPath, request.nextUrl.search), {
      method: request.method,
      headers: {
        "Content-Type": request.headers.get("content-type") || "application/json",
        ...identityHeaders(request),
      },
      body,
      cache: "no-store",
    });
  } catch (error) {
    console.error("Proxy request failed", error);
    return NextResponse.json(
      { detail: "Backend service is unavailable." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }

  return new NextResponse(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: {
      "Content-Type": upstreamResponse.headers.get("content-type") || "application/json",
      "Cache-Control": "no-store",
    },
  });
}

export async function proxyGetRequest(request: NextRequest, backendPath: string): Promise<NextResponse> {
  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(getBackendUrl(backendPath, request.nextUrl.search), {
      method: request.method,
      headers: {
        ...identityHeaders(request),
      },
      cache: "no-store",
    });
  } catch (error) {
    console.error("Proxy request failed", error);
    return NextResponse.json(
      { detail: "Backend service is unavailable." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }

  return new NextResponse(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: {
      "Content-Type": upstreamResponse.headers.get("content-type") || "application/json",
      "Cache-Control": "no-store",
    },
  });
}
