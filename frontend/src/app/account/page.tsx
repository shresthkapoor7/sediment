import type { Metadata } from "next";
import { AccountView } from "@/components/AccountView";

export const metadata: Metadata = {
  title: "Account | Sediment",
  robots: { index: false },
};

export default function AccountPage() {
  return <AccountView />;
}
