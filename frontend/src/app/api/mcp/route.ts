import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createClient } from "@supabase/supabase-js";

import { createSedimentMcpServer } from "@/lib/server/mcp";

/**
 * Sediment as a remote MCP server (Streamable HTTP, stateless). Clients sign in with OAuth: Supabase Auth is the
 * authorization server (see /.well-known/oauth-protected-resource), and the access token it issues is a normal
 * Supabase session token for the account, so every backend route accepts it.
 */
export const dynamic = "force-dynamic";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

function resourceMetadataUrl(request: Request): string {
  return `${new URL(request.url).origin}/.well-known/oauth-protected-resource`;
}

function unauthorized(request: Request, error = "invalid_token") {
  return new Response(JSON.stringify({ error, error_description: "Sign in to Sediment to use this server." }), {
    status: 401,
    headers: {
      "Content-Type": "application/json",
      "WWW-Authenticate": `Bearer error="${error}", resource_metadata="${resourceMetadataUrl(request)}"`,
    },
  });
}

async function verify(token: string): Promise<boolean> {
  if (!supabaseUrl || !supabaseKey) return false;
  const client = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.getClaims(token);
  return !error && !!data?.claims?.sub;
}

async function handle(request: Request): Promise<Response> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (!token || !(await verify(token))) return unauthorized(request);

  const server = createSedimentMcpServer(token);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(request);
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
