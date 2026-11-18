"use client";

import { useEffect, useRef, useState } from "react";

export interface AgentCapability {
  label: string;
  hint: string;
  onPick: () => void;
}

/** A small "what can the agent do" button; each entry starts a message in the composer. */
export function AgentCapabilities({ items, disabled }: { items: AgentCapability[]; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={root} style={{ position: "relative" }}>
      <button
        type="button"
        aria-label="What the agent can do"
        title="What the agent can do"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        style={{
          display: "grid",
          placeItems: "center",
          width: "1.5rem",
          height: "1.5rem",
          padding: 0,
          border: "none",
          borderRadius: "0.375rem",
          background: open ? "var(--bg-tertiary)" : "transparent",
          color: open ? "var(--text-primary)" : "var(--text-tertiary)",
          cursor: "pointer",
        }}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="8" cy="8" r="6.25" />
          <path d="M6.25 6.25a1.75 1.75 0 1 1 2.5 1.6c-.5.25-.75.6-.75 1.15v.25" />
          <circle cx="8" cy="11.25" r="0.4" fill="currentColor" />
        </svg>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="What the agent can do"
          className="no-scrollbar"
          style={{
            position: "absolute",
            top: "calc(100% + 0.375rem)",
            right: 0,
            zIndex: 30,
            width: "min(19rem, calc(100vw - 2rem))",
            maxHeight: "24rem",
            overflowY: "auto",
            padding: "0.25rem",
            borderRadius: "0.75rem",
            background: "var(--bg-primary)",
            boxShadow: "0 0 0 1px var(--border), 0 0.75rem 2rem rgba(0,0,0,0.3)",
          }}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              disabled={disabled}
              onClick={() => { item.onPick(); setOpen(false); }}
              className="agent-capability"
            >
              <span className="agent-capability-label">{item.label}</span>
              <span className="agent-capability-hint">{item.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
