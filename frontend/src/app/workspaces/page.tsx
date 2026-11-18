import type { Metadata } from "next";
import { WorkspacesView } from "@/components/workspaces/WorkspacesView";

export const metadata: Metadata = {
  title: "Workspaces | Sediment",
  description: "Group your Sediment canvases into categories.",
  robots: { index: false },
};

export default function WorkspacesPage() {
  return <WorkspacesView />;
}
