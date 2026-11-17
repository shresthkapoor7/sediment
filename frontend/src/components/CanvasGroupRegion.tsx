"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./CanvasGroupRegion.module.css";

import { Frame } from "@/lib/groups";

export const GROUP_LABEL_MAX_LENGTH = 48;

interface CanvasGroupRegionProps {
  label: string;
  count: number;
  /** Where the frame sits, in canvas coordinates. */
  frame: Frame;
  /** A dragged card is over this cluster and would join it if dropped. */
  isDropTarget?: boolean;
  getZoom?: () => number;
  /** Called while the cluster is dragged by its name row, with how far it moved since the last call. */
  onMove?: (label: string, dx: number, dy: number) => void;
  onMoveEnd?: () => void;
  /** Rename the cluster; null dissolves it and leaves the papers where they are. */
  onRename?: (label: string, next: string | null) => void;
}

export function CanvasGroupRegion({ label, count, frame, isDropTarget = false, getZoom, onRename, onMove, onMoveEnd }: CanvasGroupRegionProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (draft === null) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [draft === null]); // eslint-disable-line react-hooks/exhaustive-deps

  // Drag the name row to move the whole cluster. A press that barely travels is still a click.
  const dragRef = useRef<{ pointerId: number; lastX: number; lastY: number; startX: number; startY: number; moved: boolean; onName: boolean } | null>(null);
  // Whether the row took this press (a mouse press it can drag); otherwise the click itself renames.
  const rowPressRef = useRef(false);
  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    rowPressRef.current = false;
    if (!onMove || draft !== null || event.button !== 0 || event.pointerType === "touch") return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("[data-group-action='ungroup']")) return;
    rowPressRef.current = true;
    dragRef.current = {
      pointerId: event.pointerId,
      lastX: event.clientX,
      lastY: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      onName: Boolean(target?.closest("[data-group-action='rename']")),
    };
    // The name row is thin: hold the pointer from the first press so a fast drag is not lost.
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // The pointer is already gone; nothing to drag.
    }
  };
  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.moved) {
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4) return;
      drag.moved = true;
    }
    const zoom = getZoom?.() || 1;
    const dx = Math.round((event.clientX - drag.lastX) / zoom);
    const dy = Math.round((event.clientY - drag.lastY) / zoom);
    if (!dx && !dy) return;
    drag.lastX += dx * zoom;
    drag.lastY += dy * zoom;
    onMove?.(label, dx, dy);
  };
  const handlePointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (drag.moved) onMoveEnd?.();
    // The held pointer keeps the name button from seeing its own click, so a still press renames here.
    else if (drag.onName && event.type === "pointerup") setDraft(label);
  };

  const commit = () => {
    if (draft === null) return;
    const next = draft.trim().replace(/\s+/g, " ").slice(0, GROUP_LABEL_MAX_LENGTH);
    setDraft(null);
    if (next && next !== label) onRename?.(label, next);
  };

  return (
    <div
      className={styles.region}
      data-target={isDropTarget ? "" : undefined}
      style={{ left: frame.x, top: frame.y, width: frame.width, height: frame.height }}
    >
      <div
        className={styles.head}
        data-canvas-ui="true"
        data-movable={onMove ? "" : undefined}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
      >
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
          <button
            type="button"
            className={styles.name}
            data-group-action="rename"
            onClick={(event) => {
              // A mouse press is handled by the row (click to rename, drag to move). Keyboard, touch and
              // a cluster that cannot move rename here.
              const handledByRow = rowPressRef.current && event.detail !== 0;
              rowPressRef.current = false;
              if (!handledByRow) setDraft(label);
            }}
            title="Rename cluster, or drag to move it"
          >
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
            data-group-action="ungroup"
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
