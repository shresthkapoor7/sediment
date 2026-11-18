"use client";

import { useState } from "react";
import type { FeedPaper } from "./feeds-api";

// Keep full snapshots: changing the feed must not lose selected papers.
export function usePaperSelection() {
  const [papers, setPapers] = useState<FeedPaper[]>([]);
  return {
    papers,
    has: (id: string) => papers.some(paper => paper.id === id),
    toggle: (paper: FeedPaper) => setPapers(current => current.some(item => item.id === paper.id)
      ? current.filter(item => item.id !== paper.id)
      : [...current, paper]),
    /** Mark papers, skipping any already marked. */
    add: (incoming: FeedPaper[]) => setPapers(current => [
      ...current,
      ...incoming.filter((paper, index) => !current.some(item => item.id === paper.id) && incoming.findIndex(item => item.id === paper.id) === index),
    ]),
    clear: () => setPapers([]),
  };
}
