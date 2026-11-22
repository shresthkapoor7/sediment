import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

let client: SupabaseClient | null = null;

/** The browser Supabase client, used only for sign-in. It keeps the session in cookies, refreshes the access
 *  token before it expires and rotates the refresh token; the rest of the app only ever reads the access token.
 *  Null when the project keys are not configured, in which case sign-in is hidden. */
export function supabase(): SupabaseClient | null {
  if (!URL || !KEY || typeof window === "undefined") return null;
  client ??= createBrowserClient(URL, KEY);
  return client;
}

export const authEnabled = Boolean(URL && KEY);
