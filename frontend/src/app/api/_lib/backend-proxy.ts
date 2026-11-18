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

/** Pass the anonymous user ID through: it arrives in a header, not the URL. */
function userHeader(request: NextRequest): Record<string, string> {
  const userId = request.headers.get("x-sediment-user");
  return userId ? { "X-Sediment-User": userId } : {};
}

function getBackendUrl(pathname: string, search: string): string {
  return `${getBackendBaseUrl()}${pathname}${search}`;
}

export async function proxyJsonRequest(request: NextRequest, backendPath: string, forwardAuthorization = false): Promise<NextResponse> {
  const body = await request.text();
  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(getBackendUrl(backendPath, request.nextUrl.search), {
      method: request.method,
      headers: {
        "Content-Type": request.headers.get("content-type") || "application/json",
        ...(forwardAuthorization && request.headers.has("authorization") ? { Authorization: request.headers.get("authorization")! } : {}),
        ...userHeader(request),
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

export async function proxyGetRequest(request: NextRequest, backendPath: string, forwardAuthorization = false): Promise<NextResponse> {
  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(getBackendUrl(backendPath, request.nextUrl.search), {
      method: request.method,
      headers: {
        ...(forwardAuthorization && request.headers.has("authorization") ? { Authorization: request.headers.get("authorization")! } : {}),
        ...userHeader(request),
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
