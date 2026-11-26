"use client";

import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import { GoogleSignIn } from "@/components/GoogleSignIn";

/** "Sign in" when anonymous, the account's avatar (linking to the account page) when signed in. */
export function AccountButton() {
  const { ready, user, enabled } = useAuth();
  if (!enabled || !ready) return null;

  if (!user) {
    return (
      <GoogleSignIn className="account-button">Sign in</GoogleSignIn>
    );
  }

  const name = (user.user_metadata?.full_name as string | undefined) || user.email || "Account";
  const avatar = user.user_metadata?.avatar_url as string | undefined;
  return (
    <Link href="/account" className="account-avatar" title={name} aria-label={`Account: ${name}`}>
      {avatar ? (
        // Google profile pictures; next/image would need the host allow-listed for a 28px image.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatar} alt="" referrerPolicy="no-referrer" />
      ) : (
        <span>{name.slice(0, 1).toUpperCase()}</span>
      )}
    </Link>
  );
}
