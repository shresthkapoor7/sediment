"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { claimAnonymousWork, getOrCreateAnonymousUserId, markSessionReady, setAccessToken } from "@/lib/api";
import { authEnabled, supabase } from "@/lib/supabase";
import { setWorkspaceOwner } from "@/lib/workspaces";

interface AuthState {
  /** False until the stored session has been read, so the UI does not flash "Sign in" for a signed-in user. */
  ready: boolean;
  user: User | null;
  enabled: boolean;
  signIn: (next?: string) => Promise<void>;
  signOut: (everywhere?: boolean) => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  ready: true, user: null, enabled: false, signIn: async () => {}, signOut: async () => {},
});

const CLAIMED_KEY = "sediment_claimed";

/**
 * After sign-in, move the work this browser made anonymously onto the account, once per account + browser.
 * Reloads when canvases moved so lists on screen pick them up.
 */
let claiming: Promise<void> | null = null;
function claimOnce(accountId: string) {
  // getSession and the SIGNED_IN event can both fire on load; one request is enough.
  claiming ??= claim(accountId).finally(() => { claiming = null; });
  return claiming;
}

async function claim(accountId: string) {
  const marker = `${accountId}:${getOrCreateAnonymousUserId()}`;
  try { if (window.localStorage.getItem(CLAIMED_KEY) === marker) return; } catch { /* storage blocked: claim is idempotent */ }
  try {
    const result = await claimAnonymousWork();
    try { window.localStorage.setItem(CLAIMED_KEY, marker); } catch { /* fine */ }
    if ((result.graphs ?? 0) > 0) window.location.reload();
  } catch (error) {
    // 409: another account already owns this browser's work; nothing to move. Anything else retries next load.
    if ((error as { status?: number }).status === 409) {
      try { window.localStorage.setItem(CLAIMED_KEY, marker); } catch { /* fine */ }
    } else {
      console.error("Moving anonymous work to the account failed", error);
    }
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(!authEnabled);

  // Workspaces categories follow whoever is signed in (after the claim, so moved canvases are already theirs).
  useEffect(() => {
    if (ready) void setWorkspaceOwner(user?.id ?? null);
  }, [ready, user?.id]);

  useEffect(() => {
    const client = supabase();
    if (!client) { markSessionReady(); return; }
    let active = true;
    client.auth.getSession().then(({ data }) => {
      if (!active) return;
      setAccessToken(data.session?.access_token ?? null);
      setUser(data.session?.user ?? null);
      setReady(true);
      markSessionReady();
      if (data.session) void claimOnce(data.session.user.id);
    });
    // Fires on sign-in, sign-out and every background token refresh.
    const { data } = client.auth.onAuthStateChange((event, session) => {
      setAccessToken(session?.access_token ?? null);
      setUser(session?.user ?? null);
      if (event === "SIGNED_IN" && session) void claimOnce(session.user.id);
    });
    return () => { active = false; data.subscription.unsubscribe(); };
  }, []);

  const signIn = useCallback(async (next?: string) => {
    const client = supabase();
    if (!client) return;
    const path = next ?? `${window.location.pathname}${window.location.search}`;
    await client.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(path)}` },
    });
  }, []);

  const signOut = useCallback(async (everywhere = false) => {
    await supabase()?.auth.signOut({ scope: everywhere ? "global" : "local" });
    setAccessToken(null);
    setUser(null);
  }, []);

  const value = useMemo(() => ({ ready, user, enabled: authEnabled, signIn, signOut }), [ready, user, signIn, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
