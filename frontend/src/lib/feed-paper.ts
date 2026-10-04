import "server-only";

import { cache } from "react";
import { getBackendBaseUrl } from "@/app/api/_lib/backend-proxy";
import { FeedPaper } from "./feeds-api";

export const getFeedPaper = cache(async (slug: string): Promise<{ paper: FeedPaper | null; missing: boolean }> => {
  if (!/^(arxiv-[A-Za-z0-9._-]+|openalex-W\d+)$/.test(slug)) return { paper: null, missing: true };
  try {
    const response = await fetch(`${getBackendBaseUrl()}/api/feed-papers/${encodeURIComponent(slug)}`, {
      cache: "no-store", signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return { paper: null, missing: response.status === 404 };
    return { paper: await response.json(), missing: false };
  } catch { return { paper: null, missing: false }; }
});
