"use client";

import { useEffect, useRef, useState } from "react";
import type { HistoryItem } from "@/lib/canvas-history";
import styles from "./CanvasHistory.module.css";

interface CanvasHistoryProps {
  undoItems: HistoryItem[];
  redoItems: HistoryItem[];
  onUndo: (steps: number) => void;
  onRedo: (steps: number) => void;
}

const buttonStyle = (enabled: boolean, active = false): React.CSSProperties => ({
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: "1.75rem",
  height: "1.75rem",
  padding: 0,
  background: active ? "var(--accent-soft)" : "transparent",
  border: "none",
  borderRadius: "0.375rem",
  color: active ? "var(--accent)" : "var(--text-secondary)",
  opacity: enabled ? 1 : 0.35,
  cursor: enabled ? "pointer" : "default",
  touchAction: "manipulation",
});

const rowStyle = (dimmed: boolean): React.CSSProperties => ({
  display: "block",
  width: "100%",
  padding: "0.4375rem 0.75rem",
  background: "none",
  border: "none",
  textAlign: "left",
  color: dimmed ? "var(--text-tertiary)" : "var(--text-primary)",
  fontFamily: "inherit",
  fontSize: "0.75rem",
  lineHeight: 1.35,
  cursor: "pointer",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

/** Undo, redo, and a list of recent steps; picking a step takes the canvas back (or forward) to that point. */
export function CanvasHistory({ undoItems, redoItems, onUndo, onRedo }: CanvasHistoryProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const canUndo = undoItems.length > 0;
  const canRedo = redoItems.length > 0;

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const visibleRedo = [...redoItems].reverse();

  return (
    <div ref={root} data-canvas-ui="true" style={{ position: "relative", display: "flex", alignItems: "center", gap: "0.25rem" }}>
      <button
        type="button"
        title="Undo (⌘Z)"
        aria-label="Undo"
        disabled={!canUndo}
        onClick={() => onUndo(1)}
        style={buttonStyle(canUndo)}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M5.5 3 2.5 6l3 3" />
          <path d="M2.5 6H10a3.5 3.5 0 0 1 0 7H6" />
        </svg>
      </button>
      <button
        type="button"
        title="Redo (⇧⌘Z)"
        aria-label="Redo"
        disabled={!canRedo}
        onClick={() => onRedo(1)}
        style={buttonStyle(canRedo)}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m10.5 3 3 3-3 3" />
          <path d="M13.5 6H6a3.5 3.5 0 0 0 0 7h4" />
        </svg>
      </button>
      <button
        type="button"
        title="History"
        aria-label="Show history of changes"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        style={buttonStyle(true, open)}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="8" cy="8" r="5.75" />
          <path d="M8 4.75V8l2.25 1.5" />
        </svg>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="History of changes"
          style={{
            position: "absolute",
            bottom: "calc(100% + 0.75rem)",
            left: 0,
            width: "17rem",
            maxHeight: "18rem",
            overflowY: "auto",
            padding: "0.25rem 0",
            borderRadius: "0.625rem",
            border: "0.0625rem solid var(--border-hover)",
            background: "var(--bg-secondary)",
            boxShadow: "0 0.5rem 1.5rem rgba(0,0,0,0.18), 0 0.125rem 0.375rem rgba(0,0,0,0.08)",
            zIndex: 30,
          }}
        >
          {!canUndo && !canRedo && (
            <p style={{ margin: 0, padding: "0.75rem", fontSize: "0.75rem", lineHeight: 1.5, color: "var(--text-tertiary)" }}>
              Nothing to undo yet. Changes you and the agent make will show up here.
            </p>
          )}
          {visibleRedo.map((item) => (
            <button
              key={`redo-${item.id}`}
              type="button"
              className={styles.row}
              title="Redo up to here"
              style={rowStyle(true)}
              onClick={() => { onRedo(item.steps); setOpen(false); }}
            >
              <span aria-hidden="true" style={{ marginRight: "0.5rem" }}>↷</span>{item.label}
            </button>
          ))}
          {canRedo && canUndo && <div aria-hidden="true" style={{ height: "0.0625rem", margin: "0.25rem 0", background: "var(--border)" }} />}
          {undoItems.map((item) => (
            <button
              key={`undo-${item.id}`}
              type="button"
              className={styles.row}
              title="Undo back to before this"
              style={rowStyle(false)}
              onClick={() => { onUndo(item.steps); setOpen(false); }}
            >
              <span aria-hidden="true" style={{ marginRight: "0.5rem", color: "var(--text-tertiary)" }}>↶</span>{item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
