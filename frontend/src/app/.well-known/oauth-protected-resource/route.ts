// OAuth protected-resource metadata (RFC 9728) for the MCP endpoint: tells MCP clients that Supabase Auth issues
// the tokens, so they can register, send the researcher through /oauth/consent, and come back with a token.
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
  return Response.json({
    resource: `${origin}/api/mcp`,
    authorization_servers: [`${supabaseUrl}/auth/v1`],
    scopes_supported: ["openid", "email", "profile"],
    bearer_methods_supported: ["header"],
    resource_name: "Sediment",
  }, { headers: { "Cache-Control": "public, max-age=3600", "Access-Control-Allow-Origin": "*" } });
}
