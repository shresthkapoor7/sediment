"use client";

import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import { GoogleSignIn } from "@/components/GoogleSignIn";

/** "Sign in" while anonymous. Signed in, the avatar lives inside the usage meter (see AccountAvatar). */
export function AccountButton() {
  const { ready, user, enabled } = useAuth();
  if (!enabled || !ready || user) return null;
  return <GoogleSignIn className="account-button">Sign in</GoogleSignIn>;
}

/** The signed-in avatar, linking to the account page. Rendered inside the usage meter's ring. */
export function AccountAvatar() {
  const { user } = useAuth();
  if (!user) return null;
  const name = (user.user_metadata?.full_name as string | undefined) || user.email || "Account";
  const avatar = user.user_metadata?.avatar_url as string | undefined;
  return (
    <Link href="/account" className="account-avatar" title={name} aria-label={`Account: ${name}`}>
      {avatar ? (
        // Google profile pictures; next/image would need the host allow-listed for a 20px image.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatar} alt="" referrerPolicy="no-referrer" />
      ) : (
        <span>{name.slice(0, 1).toUpperCase()}</span>
      )}
    </Link>
  );
}
