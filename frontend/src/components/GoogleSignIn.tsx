"use client";

import { useEffect, useRef } from "react";
import { useAuth } from "@/components/AuthProvider";
import { supabase } from "@/lib/supabase";

/**
 * Sign in with Google Identity Services instead of a redirect through Supabase, so Google's prompt names
 * sediment-ai.com rather than the Supabase project domain. Google hands us a signed ID token; Supabase checks it
 * (signature, our client ID, the nonce) and issues its usual session.
 *
 * GIS only opens its popup from its own button, so ours is drawn as usual and Google's invisible button sits on top
 * of it and takes the click. Without a client ID configured it falls back to the Supabase redirect.
 */
export const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";

interface GoogleId {
  initialize(config: Record<string, unknown>): void;
  renderButton(el: HTMLElement, options: Record<string, unknown>): void;
}
declare global {
  interface Window { google?: { accounts: { id: GoogleId } } }
}

let scriptPromise: Promise<void> | null = null;
function loadScript(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  scriptPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => { scriptPromise = null; reject(new Error("Google sign-in failed to load")); };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

// One nonce at a time: Google gets its hash inside the token, Supabase gets the raw value and compares.
// GIS keeps one global config, so initialize once per nonce rather than once per button on the page.
let rawNonce = "";
let afterSignIn: (() => void) | undefined;
let initialized: Promise<void> | null = null;
function ensureInitialized() {
  initialized ??= initialize();
  return initialized;
}
async function initialize() {
  rawNonce = crypto.randomUUID();
  const hashed = await sha256Hex(rawNonce);
  window.google!.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    nonce: hashed,
    use_fedcm_for_button: true,
    callback: async ({ credential }: { credential: string }) => {
      const nonce = rawNonce;
      // Re-arm with a fresh nonce straight away so a retry never reuses one.
      initialized = initialize();
      const { error } = await supabase()!.auth.signInWithIdToken({ provider: "google", token: credential, nonce });
      if (error) console.error("Google sign-in failed", error);
      else afterSignIn?.();
    },
  });
}

export function GoogleSignIn({ className, children, next }: { className?: string; children: React.ReactNode; next?: string }) {
  const { signIn } = useAuth();
  const overlay = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;
    let cancelled = false;
    loadScript()
      .then(() => {
        afterSignIn = next ? () => { window.location.assign(next); } : undefined;
        return ensureInitialized();
      })
      .then(() => {
        if (cancelled || !overlay.current) return;
        const width = Math.max(200, Math.ceil(overlay.current.getBoundingClientRect().width));
        window.google!.accounts.id.renderButton(overlay.current, { type: "standard", size: "large", width });
      })
      .catch((e) => console.error(e));
    return () => { cancelled = true; };
  }, [next]);

  if (!GOOGLE_CLIENT_ID) {
    return <button type="button" className={className} onClick={() => void signIn(next)}>{children}</button>;
  }
  return (
    <span className="google-signin">
      <button type="button" className={className} tabIndex={-1} aria-hidden="true">{children}</button>
      <div ref={overlay} className="google-signin-overlay" aria-label="Sign in with Google" />
    </span>
  );
}
