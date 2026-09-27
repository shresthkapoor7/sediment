"use client";

import { m } from "framer-motion";
import styles from "./discovery.module.css";

export interface DiscoveryPreviewData {
  kind: "paper" | "topic";
  pill: string; // "ARTICLE PREVIEW" / "SUB-FIELD"
  title: string;
  metaLine: string[]; // e.g. ["2019", "paper"]
  authors?: string[];
  summary?: string;
  href?: string;
  openLabel: string; // "Open article"
  url?: string;
  bottomLabel: string; // "TOPICS" / "PAPERS"
  bottomItems: string[];
  accent: string; // topic colour for a sub-field, --accent for a paper
}

interface DiscoveryPreviewProps {
  data: DiscoveryPreviewData;
  left: number;
  top: number;
  width: number;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

/** Hoverable paper details, styled like the feed cards. */
export function DiscoveryPreview({ data, left, top, width, onMouseEnter, onMouseLeave }: DiscoveryPreviewProps) {
  return (
    <m.div className={styles.preview} key={data.title}
      initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }}
      transition={{ duration: 0.15 }} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}
      style={{ top, left, width }}
    >
      <div className={styles.previewMeta}><span style={{ color: data.accent }}>{data.pill}</span><span>{data.metaLine.join(" · ")}</span></div>
      <h2>{data.title}</h2>
      {!!data.authors?.length && <p className={styles.authors}>{data.authors.slice(0, 4).join(", ")}{data.authors.length > 4 ? " +" : ""}</p>}
      <p className={styles.summary}>{data.summary || "Summary unavailable."}</p>
      {data.bottomItems.length > 0 && <div className={styles.related}><span>{data.bottomLabel}</span><p>{data.bottomItems.join(" · ")}</p></div>}
      {data.href && <a className={styles.articleLink} href={data.href} target="_blank" rel="noopener noreferrer">{data.openLabel}</a>}
    </m.div>
  );
}
