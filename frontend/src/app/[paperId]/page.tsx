import { FeedPaperRoute } from "@/components/feeds/FeedPaperRoute";
export { paperMetadata as generateMetadata } from "@/components/feeds/FeedPaperRoute";

export default function PaperPage({ params }: { params: Promise<{ paperId: string }> }) {
  return <FeedPaperRoute params={params} />;
}
