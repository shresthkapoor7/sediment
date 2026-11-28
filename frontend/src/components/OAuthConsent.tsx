"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { OAuthAuthorizationDetails } from "@supabase/supabase-js";
import { AsciiBackdrop } from "@/components/AsciiBackdrop";
import { useAuth } from "@/components/AuthProvider";
import { GoogleSignIn } from "@/components/GoogleSignIn";
import { LogoMark } from "@/components/LogoMark";
import { supabase } from "@/lib/supabase";
import shell from "@/components/workspaces/WorkspacesView.module.css";
import styles from "./AccountView.module.css";

/**
 * Where an MCP client (Claude, Cursor, …) sends you to connect to Sediment. Supabase Auth is the OAuth server; this
 * page shows who is asking and where you will be sent back, then approves or denies. Clients register themselves, so
 * the name is whatever they chose: the redirect domain is the part to trust.
 */
export function OAuthConsent() {
  const authorizationId = useSearchParams().get("authorization_id");
  const { ready, user } = useAuth();
  const [details, setDetails] = useState<OAuthAuthorizationDetails | null>(null);
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const client = supabase();
    if (!ready || !user || !authorizationId || !client) return;
    let active = true;
    client.auth.oauth.getAuthorizationDetails(authorizationId).then(({ data, error }) => {
      if (!active) return;
      if (error || !data) { setProblem("This connection request has expired or is invalid. Start again from the app."); return; }
      // Already approved before: go straight back.
      if ("redirect_url" in data) { window.location.assign(data.redirect_url); return; }
      setDetails(data);
    });
    return () => { active = false; };
  }, [authorizationId, ready, user]);

  const decide = async (approve: boolean) => {
    const client = supabase();
    if (!client || !authorizationId) return;
    setBusy(true);
    const { data, error } = approve
      ? await client.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true })
      : await client.auth.oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true });
    if (error || !data) { setBusy(false); setProblem("Something went wrong. Start again from the app."); return; }
    window.location.assign(data.redirect_url);
  };

  let redirectHost = "";
  try { redirectHost = details ? new URL(details.redirect_uri).host : ""; } catch { redirectHost = details?.redirect_uri ?? ""; }

  return (
    <div className={`landing-shell ${shell.shell}`}>
      <div className={shell.backdrop}><AsciiBackdrop /></div>
      <div className={shell.page}>
        <header className={shell.topbar}>
          <Link href="/" className={shell.brand}><LogoMark width="28" height="28" /><span>Sediment</span></Link>
        </header>
        <main className={`${shell.main} ${styles.main}`}>
          <div className={shell.headingText}><h1>Connect an app</h1></div>
          {!authorizationId ? (
            <p className={styles.note}>Missing connection request. Start again from the app you are connecting.</p>
          ) : !ready ? null : !user ? (
            <section className={styles.card}>
              <h2>Sign in to continue</h2>
              <p className={styles.note}>An app wants to use your Sediment canvases. Sign in first to review the request.</p>
              <GoogleSignIn className={styles.primary}>Sign in with Google</GoogleSignIn>
            </section>
          ) : problem ? (
            <p className={styles.note}>{problem}</p>
          ) : !details ? (
            <p className={styles.note}>Loading…</p>
          ) : (
            <section className={styles.card}>
              <h2>{details.client.name || "An app"} wants to use your Sediment account</h2>
              <p className={styles.note}>
                It will be able to search papers and read and edit your canvases as {details.user.email}. Its edits
                show up in each canvas&apos;s history as made through it.
              </p>
              <p className={styles.note} style={{ marginTop: ".75rem" }}>
                You will be sent back to <strong>{redirectHost}</strong>. Only continue if you started this from an
                app you trust at that address.
              </p>
              <div className={styles.actions} style={{ marginTop: "1rem" }}>
                <button type="button" className={styles.primary} style={{ marginTop: 0 }} disabled={busy} onClick={() => void decide(true)}>Allow</button>
                <button type="button" className={styles.secondary} disabled={busy} onClick={() => void decide(false)}>Deny</button>
              </div>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
