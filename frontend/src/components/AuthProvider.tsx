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
  /** Resolves to an error message when the sign-out failed (the session is then kept). */
  signOut: (everywhere?: boolean) => Promise<string | null>;
}

const AuthContext = createContext<AuthState>({
  ready: true, user: null, enabled: false, signIn: async () => {}, signOut: async () => null,
});

const TAKEN_KEY = "sediment_claim_taken";

/**
 * After sign-in, move the work this browser made anonymously onto the account. The claim is idempotent and cheap,
 * so it runs on every signed-in load: work made while signed out between sessions is picked up too. Only a browser
 * that belongs to a different account is remembered, so it is not asked again. Resolves to whether canvases moved
 * (the page then reloads to show them).
 */
let claiming: Promise<boolean> | null = null;
function claimOnce(accountId: string): Promise<boolean> {
  // getSession and the SIGNED_IN event can both fire on load; one request is enough.
  claiming ??= claim(accountId).finally(() => { claiming = null; });
  return claiming;
}

async function claim(accountId: string): Promise<boolean> {
  const marker = `${accountId}:${getOrCreateAnonymousUserId()}`;
  try { if (window.localStorage.getItem(TAKEN_KEY) === marker) return false; } catch { /* storage blocked */ }
  try {
    const result = await claimAnonymousWork();
    if ((result.graphs ?? 0) > 0) { window.location.reload(); return true; }
  } catch (error) {
    // 409: another account already owns this browser's work. Anything else retries next load.
    if ((error as { status?: number }).status === 409) {
      try { window.localStorage.setItem(TAKEN_KEY, marker); } catch { /* fine */ }
    } else {
      console.error("Moving anonymous work to the account failed", error);
    }
  }
  return false;
}

/** Workspaces categories follow the signed-in account, but only once the claim has settled, so categories never
 *  get reconciled against a canvas list that is missing canvases still being moved. */
let currentAccount: string | null | undefined;
async function followAccount(accountId: string | null) {
  currentAccount = accountId;
  if (accountId && (await claimOnce(accountId))) return; // reloading
  // Signed out (or switched) while the claim ran: that newer call owns Workspaces now.
  if (currentAccount !== accountId) return;
  await setWorkspaceOwner(accountId);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(!authEnabled);

  useEffect(() => {
    if (ready) void followAccount(user?.id ?? null);
  }, [ready, user?.id]);

  useEffect(() => {
    const client = supabase();
    if (!client) { markSessionReady(); return; }
    let active = true;
    client.auth.getSession()
      .then(({ data }) => {
        if (!active) return;
        setAccessToken(data.session?.access_token ?? null);
        setUser(data.session?.user ?? null);
      })
      .catch((error) => console.error("Reading the session failed", error))
      .finally(() => {
        // Requests wait on this; never leave them hanging, even if the session could not be read.
        markSessionReady();
        if (active) setReady(true);
      });
    // Fires on sign-in, sign-out and every background token refresh.
    const { data } = client.auth.onAuthStateChange((event, session) => {
      setAccessToken(session?.access_token ?? null);
      setUser(session?.user ?? null);
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

  const signOut = useCallback(async (everywhere = false): Promise<string | null> => {
    try {
      const result = await supabase()?.auth.signOut({ scope: everywhere ? "global" : "local" });
      if (result?.error) return result.error.message || "Could not sign out.";
    } catch (error) {
      return error instanceof Error ? error.message : "Could not sign out.";
    }
    setAccessToken(null);
    setUser(null);
    return null;
  }, []);

  const value = useMemo(() => ({ ready, user, enabled: authEnabled, signIn, signOut }), [ready, user, signIn, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
