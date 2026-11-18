"use client";

import { useRef, useState } from "react";
import styles from "./ConversationNavigator.module.css";

export interface ConversationNavigationItem {
  id: string;
  label: string;
  /** The start of the reply, shown under the question in the hover preview. */
  detail?: string;
}

interface ConversationNavigatorProps {
  items: ConversationNavigationItem[];
  onJump: (id: string) => void;
  activeId?: string | null;
  onActiveChange?: (id: string) => void;
}

const SPACING = 10;
const MAX_HEIGHT = 320;

/** For screen readers: the question as written, only whitespace tidied (so "Use C#" stays "Use C#"). */
function spoken(text: string | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function compact(text: string | undefined): string {
  return (text ?? "").replace(/[#*_`>]/g, "").replace(/\s+/g, " ").trim();
}

/** One line per question; hover to see it and the reply, click to jump. Modelled on T3 Code's chat minimap. */
export function ConversationNavigator({ items, onJump, activeId, onActiveChange }: ConversationNavigatorProps) {
  const [hot, setHot] = useState<number | null>(null);
  const railRef = useRef<HTMLDivElement>(null);

  if (items.length < 2) return null;

  const height = Math.min((items.length - 1) * SPACING, MAX_HEIGHT);
  const topPercent = (index: number) => (index / (items.length - 1)) * 100;
  const currentIndex = Math.max(0, items.findIndex((item) => item.id === activeId));
  const focusIndex = hot ?? currentIndex;
  const hotItem = hot === null ? null : items[hot];

  const jump = (index: number) => {
    const item = items[index];
    if (!item) return;
    onActiveChange?.(item.id);
    onJump(item.id);
  };

  const indexFromPointer = (clientY: number) => {
    const rect = railRef.current?.getBoundingClientRect();
    if (!rect || rect.height === 0) return 0;
    const ratio = Math.min(Math.max((clientY - rect.top) / rect.height, 0), 1);
    return Math.round(ratio * (items.length - 1));
  };

  return (
    <div className={styles.root} data-canvas-ui="true">
      <div ref={railRef} className={styles.rail} style={{ height }}>
        <button
          type="button"
          className={`${styles.step} ${styles.prev}`}
          aria-label="Previous question"
          title="Previous question"
          disabled={currentIndex <= 0}
          onClick={() => jump(currentIndex - 1)}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3 7.5 3-3 3 3" /></svg>
        </button>
        <button
          type="button"
          className={styles.hit}
          aria-label={hotItem
            ? `Question ${hot! + 1} of ${items.length}: ${spoken(hotItem.label)}. Press Enter to jump.`
            : `Jump to a question (${items.length}). Use the arrow keys to choose.`}
          onMouseMove={(event) => setHot(indexFromPointer(event.clientY))}
          onMouseLeave={() => setHot(null)}
          onBlur={() => setHot(null)}
          onClick={(event) => jump(indexFromPointer(event.clientY))}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const next = Math.min(Math.max(focusIndex + (event.key === "ArrowDown" ? 1 : -1), 0), items.length - 1);
              setHot(next);
            } else if ((event.key === "Enter" || event.key === " ") && hot !== null) {
              event.preventDefault();
              jump(hot);
            }
          }}
        />
        {items.map((item, index) => {
          const distance = Math.abs(index - focusIndex);
          const scale = distance === 0 ? 1 : distance === 1 ? 0.67 : distance === 2 ? 0.45 : 0.33;
          return (
            <span
              key={item.id}
              className={styles.strip}
              data-current={index === currentIndex ? "" : undefined}
              data-hot={index === hot ? "" : undefined}
              style={{ top: `${topPercent(index)}%`, transform: `translateY(-50%) scaleX(${scale})` }}
            />
          );
        })}
        <button
          type="button"
          className={`${styles.step} ${styles.next}`}
          aria-label="Next question"
          title="Next question"
          disabled={currentIndex >= items.length - 1}
          onClick={() => jump(currentIndex + 1)}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3 4.5 3 3 3-3" /></svg>
        </button>
        {/* Announces the question chosen with the arrow keys; the visual preview is hidden from screen readers. */}
        <span className={styles.srOnly} role="status" aria-live="polite">
          {hotItem ? `Question ${hot! + 1} of ${items.length}: ${spoken(hotItem.label)}` : ""}
        </span>
        {hotItem && (
          <div className={styles.preview} style={{ top: `${topPercent(hot!)}%` }} aria-hidden="true">
            <span className={styles.previewTitle}>{compact(hotItem.label)}</span>
            {hotItem.detail && <div className={styles.previewDetail}>{compact(hotItem.detail)}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
