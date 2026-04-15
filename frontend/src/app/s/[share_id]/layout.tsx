import type { Metadata } from "next";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ share_id: string }>;
}): Promise<Metadata> {
  const { share_id } = await params;

  try {
    const res = await fetch(`${API_BASE}/api/share/${share_id}`, {
      next: { revalidate: 3600 },
    });

    if (res.ok) {
      const graph = await res.json();
      const title = graph.query as string | undefined;

      if (title) {
        return {
          title: `${title} — Sediment`,
          description: `Explore the research lineage of "${title}" — trace the papers and ideas that shaped this concept over time.`,
          openGraph: {
            title: `${title} — Sediment`,
            description: `Explore the research lineage of "${title}" — trace the papers and ideas that shaped this concept over time.`,
            siteName: "Sediment",
          },
          twitter: {
            card: "summary",
            title: `${title} — Sediment`,
            description: `Explore the research lineage of "${title}" — trace the papers and ideas that shaped this concept over time.`,
          },
        };
      }
    }
  } catch {
    // fall through to defaults
  }

  return {
    title: "Shared lineage — Sediment",
    description: "Explore a shared research lineage on Sediment.",
  };
}

export default function SharedLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
