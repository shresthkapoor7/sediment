import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

/** Google sends people back here with a one-time code; trading it for a session sets the auth cookies. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const requested = searchParams.get("next") ?? "/";
  // Only same-site paths, so the callback can never be used to bounce someone to another site.
  const next = requested.startsWith("/") && !requested.startsWith("//") ? requested : "/";

  if (code) {
    const cookieStore = await cookies();
    const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (entries) => entries.forEach(({ name, value, options }) => cookieStore.set(name, value, options)),
      },
    });
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  }
  return NextResponse.redirect(`${origin}/?signin=failed`);
}
