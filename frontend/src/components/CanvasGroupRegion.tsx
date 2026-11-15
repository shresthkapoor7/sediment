"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./CanvasGroupRegion.module.css";

const PADDING = 24;
const LABEL_HEIGHT = 40;
export const GROUP_LABEL_MAX_LENGTH = 48;

interface CanvasGroupRegionProps {
  label: string;
  count: number;
  /** Bounding box of the cluster's papers, in canvas coordinates. */
  box: { minX: number; minY: number; maxX: number; maxY: number };
  /** Rename the cluster; null dissolves it and leaves the papers where they are. */
  onRename?: (label: string, next: string | null) => void;
}

export function CanvasGroupRegion({ label, count, box, onRename }: CanvasGroupRegionProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (draft === null) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [draft === null]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = () => {
    if (draft === null) return;
    const next = draft.trim().replace(/\s+/g, " ").slice(0, GROUP_LABEL_MAX_LENGTH);
    setDraft(null);
    if (next && next !== label) onRename?.(label, next);
  };

  return (
    <div
      className={styles.region}
      style={{
        left: box.minX - PADDING,
        top: box.minY - PADDING - LABEL_HEIGHT,
        width: box.maxX - box.minX + PADDING * 2,
        height: box.maxY - box.minY + PADDING * 2 + LABEL_HEIGHT,
      }}
    >
      <div className={styles.head} data-canvas-ui="true" onPointerDown={(event) => event.stopPropagation()}>
        {draft !== null ? (
          <input
            ref={inputRef}
            className={styles.name}
            value={draft}
            maxLength={GROUP_LABEL_MAX_LENGTH}
            aria-label="Cluster name"
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter") commit();
              if (event.key === "Escape") setDraft(null);
            }}
          />
        ) : onRename ? (
          <button type="button" className={styles.name} onClick={() => setDraft(label)} title="Rename cluster">
            {label}
          </button>
        ) : (
          <span className={styles.name}>{label}</span>
        )}
        <span className={styles.count}>{count} {count === 1 ? "paper" : "papers"}</span>
        {onRename && draft === null && (
          <button
            type="button"
            className={styles.ungroup}
            onClick={() => onRename(label, null)}
            title="Ungroup these papers"
            aria-label={`Ungroup ${label}`}
          >
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
              <path d="M2 2l8 8M10 2l-8 8" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
