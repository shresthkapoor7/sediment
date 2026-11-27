"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AsciiBackdrop } from "@/components/AsciiBackdrop";
import { GoogleSignIn } from "@/components/GoogleSignIn";
import { useAuth } from "@/components/AuthProvider";
import { LogoMark } from "@/components/LogoMark";
import { fetchUsage } from "@/lib/api";
import shell from "@/components/workspaces/WorkspacesView.module.css";
import styles from "./AccountView.module.css";

type Usage = Awaited<ReturnType<typeof fetchUsage>>;

export function AccountView() {
  const { ready, user, enabled, signOut } = useAuth();
  const [usage, setUsage] = useState<Usage | null>(null);
  const [usageFailed, setUsageFailed] = useState(false);
  const [usageAttempt, setUsageAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [signOutError, setSignOutError] = useState("");

  useEffect(() => {
    if (!ready) return;
    let active = true;
    fetchUsage()
      .then((value) => { if (active) { setUsage(value); setUsageFailed(false); } })
      .catch(() => { if (active) setUsageFailed(true); });
    return () => { active = false; };
  }, [ready, user?.id, usageAttempt]);

  const retryUsage = () => { setUsageFailed(false); setUsageAttempt((n) => n + 1); };

  const leave = async (everywhere: boolean) => {
    setBusy(true);
    setSignOutError("");
    const error = await signOut(everywhere);
    if (error) {
      setSignOutError(`Could not sign out: ${error}`);
      setBusy(false);
      return;
    }
    // Canvases, chats and credits all belong to whoever is signed in, so start the app over as the browser.
    window.location.assign("/");
  };

  const name = (user?.user_metadata?.full_name as string | undefined) || user?.email || "";
  const avatar = user?.user_metadata?.avatar_url as string | undefined;

  return (
    <div className={`landing-shell ${shell.shell}`}>
      <div className={shell.backdrop}><AsciiBackdrop /></div>
      <div className={shell.page}>
        <header className={shell.topbar}>
          <Link href="/" className={shell.brand}><LogoMark width="28" height="28" /><span>Sediment</span></Link>
          <Link href="/workspaces" className={styles.navLink}>Workspaces</Link>
          <span className={styles.here} aria-current="page">Account</span>
        </header>

        <main className={`${shell.main} ${styles.main}`}>
          <div className={shell.headingText}>
            <h1>Account</h1>
          </div>

          {!ready ? null : !enabled ? (
            <p className={styles.note}>Accounts are not available on this deployment.</p>
          ) : !user ? (
            <section className={styles.card}>
              <h2>You are not signed in</h2>
              <p className={styles.note}>
                Your canvases live in this browser for now. Sign in with Google to keep them with your account,
                use them on any device, and get a larger daily allowance.
              </p>
              <GoogleSignIn className={styles.primary}>Sign in with Google</GoogleSignIn>
            </section>
          ) : (
            <>
              <section className={styles.card}>
                <div className={styles.profile}>
                  <span className={styles.avatar}>
                    {avatar
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={avatar} alt="" referrerPolicy="no-referrer" />
                      : name.slice(0, 1).toUpperCase()}
                  </span>
                  <div>
                    <div className={styles.name}>{name}</div>
                    {user.email && user.email !== name && <div className={styles.email}>{user.email}</div>}
                  </div>
                </div>
              </section>

              <section className={styles.card}>
                <h2>Today&apos;s usage</h2>
                {usage ? (
                  <>
                    <div className={styles.meter} aria-hidden="true">
                      <span style={{ width: `${Math.min(100, (usage.used / Math.max(usage.dailyLimit, 0.0001)) * 100)}%` }} />
                    </div>
                    <p className={styles.note}>
                      ${usage.used.toFixed(2)} of ${usage.dailyLimit.toFixed(2)} used across {usage.requestCount} {usage.requestCount === 1 ? "request" : "requests"}. Resets daily.
                    </p>
                  </>
                ) : usageFailed ? (
                  <div className={styles.actions}>
                    <p className={styles.note}>Couldn&apos;t load today&apos;s usage.</p>
                    <button type="button" className={styles.secondary} onClick={retryUsage}>Try again</button>
                  </div>
                ) : <p className={styles.note}>Loading…</p>}
              </section>

              <section className={styles.card}>
                <h2>Sessions</h2>
                <div className={styles.actions}>
                  <button type="button" className={styles.secondary} disabled={busy} onClick={() => void leave(false)}>Sign out</button>
                  <button type="button" className={styles.secondary} disabled={busy} onClick={() => void leave(true)}>Sign out everywhere</button>
                </div>
                {signOutError && <p className={styles.note} role="alert" style={{ marginTop: ".75rem" }}>{signOutError}</p>}
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
