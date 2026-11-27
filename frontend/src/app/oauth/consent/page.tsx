import type { Metadata } from "next";
import { Suspense } from "react";
import { OAuthConsent } from "@/components/OAuthConsent";

export const metadata: Metadata = {
  title: "Connect an app | Sediment",
  robots: { index: false },
};

export default function OAuthConsentPage() {
  return <Suspense><OAuthConsent /></Suspense>;
}
