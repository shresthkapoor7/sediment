import type { Metadata } from "next";

const API_BASE =
  process.env.API_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "http://127.0.0.1:8000";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ share_id: string }>;
}): Promise<Metadata> {
  const { share_id } = await params;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch(`${API_BASE}/api/share/${encodeURIComponent(share_id)}`, {
      next: { revalidate: 3600 },
      signal: controller.signal,
    });
    clearTimeout(timeout);

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
  } catch (err) {
    clearTimeout(timeout);
    console.error("[generateMetadata] share fetch failed:", err);
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
