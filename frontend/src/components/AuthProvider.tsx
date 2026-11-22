"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { markSessionReady, setAccessToken } from "@/lib/api";
import { authEnabled, supabase } from "@/lib/supabase";

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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(!authEnabled);

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
    });
    // Fires on sign-in, sign-out and every background token refresh.
    const { data } = client.auth.onAuthStateChange((_event, session) => {
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

  const signOut = useCallback(async (everywhere = false) => {
    await supabase()?.auth.signOut({ scope: everywhere ? "global" : "local" });
    setAccessToken(null);
    setUser(null);
  }, []);

  const value = useMemo(() => ({ ready, user, enabled: authEnabled, signIn, signOut }), [ready, user, signIn, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
