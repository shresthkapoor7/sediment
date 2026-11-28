"use client";

import Link from "next/link";
import { AccountAvatar, AccountButton } from "@/components/AccountButton";
import { useAuth } from "@/components/AuthProvider";
import { CreditsMeter } from "@/components/CreditsMeter";

/**
 * The right side of the home and Workspaces headers: the usage meter (with the avatar inside when signed in),
 * Workspaces, and Sign in when signed out. One component so both pages look and behave the same.
 */
export function SiteNav({ credits, current }: { credits: number; current?: "workspaces" }) {
  const { ready, user } = useAuth();
  const signedIn = ready && !!user;
  return (
    <div className="site-nav credit-meter-bar">
      <CreditsMeter credits={credits} expandable avatar={signedIn ? <AccountAvatar /> : undefined} />
      <Link
        href="/workspaces"
        className="app-header-labeled-action app-header-workspaces"
        aria-current={current === "workspaces" ? "page" : undefined}
      >
        <span className="app-header-action-label">Workspaces</span>
      </Link>
      <AccountButton />
    </div>
  );
}
