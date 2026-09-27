"use client";

import { useState } from "react";
import { FeedPaper } from "@/lib/feeds-api";
import { illustrationFor } from "@/lib/feed-illustrations";

export function FeedPaperImage({ paper, className }: { paper: FeedPaper; className: string }) {
  const [failed, setFailed] = useState<string[]>([]);
  const illustration = illustrationFor(paper);
  const thumbnail = paper.thumbnail?.startsWith("https://cdn-thumbnails.huggingface.co/") ? paper.thumbnail : null;
  const src = [thumbnail, illustration].find(candidate => candidate && !failed.includes(candidate));
  if (!src) return null;
  return <figure className={className}>
    {/* Provider thumbnails and local SVGs need no image transformation service. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(current => [...current, src])} />
    <figcaption>{src === thumbnail ? "Paper thumbnail · Hugging Face" : "Topic illustration"}</figcaption>
  </figure>;
}
