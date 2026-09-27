import { getFeedPaper } from "@/lib/feed-paper";
import { FeedPaperDetail } from "./FeedPaperDetail";

export async function paperMetadata({ params }: { params: Promise<{ paperId: string }> }) {
  const { paperId } = await params;
  const { paper } = await getFeedPaper(paperId);
  return { title: paper ? `${paper.title} | Sediment` : "Paper details | Sediment" };
}

export async function FeedPaperRoute({ params, intercepted = false }: { params: Promise<{ paperId: string }>; intercepted?: boolean }) {
  const { paperId } = await params;
  const { paper, missing } = await getFeedPaper(paperId);
  return <FeedPaperDetail paper={paper} missing={missing} intercepted={intercepted} />;
}
