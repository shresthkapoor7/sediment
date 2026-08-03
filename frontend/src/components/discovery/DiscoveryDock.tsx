"use client";

import Link from "next/link";
import { useState } from "react";
import { m } from "framer-motion";
import { LogoMark } from "@/components/LogoMark";
import { ThemeToggle } from "@/components/ThemeToggle";
import type { PlacedTopic } from "@/lib/discovery";

interface DiscoveryDockProps {
  concept: string;
  selectedTopics: PlacedTopic[];
  sharedCount: number;
  onClearSelection: () => void;
  chatOpen: boolean;
  onToggleChat: () => void;
}

/** Reuses the graph-view header styling (.app-header-graph) so the dock matches
 *  the rest of the app: floating centred pill, collapse toggle, icon actions. */
export function DiscoveryDock({
  concept,
  selectedTopics,
  sharedCount,
  onClearSelection,
  chatOpen,
  onToggleChat,
}: DiscoveryDockProps) {
  const [compact, setCompact] = useState(false);
  const hasSelection = selectedTopics.length > 0;

  return (
    <m.header
      className={`app-header app-header-graph${compact ? " app-header-compact" : ""}`}
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      style={{ position: "absolute", inset: "0 0 auto", zIndex: 50 }}
    >
      <div className="app-header-actions" style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <div className="desktop-only" style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <Link className="app-header-labeled-action" href="/" aria-label="Sediment home">
            <LogoMark className="app-header-sediment-icon" width="16" height="16" />
            <span className="app-header-action-label app-header-sediment-label">Sediment</span>
          </Link>

          <span className="app-header-graph-query" title={concept}>
            {concept}
          </span>

          {hasSelection && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                height: "2rem",
                padding: "0 0.25rem 0 0.625rem",
                borderRadius: "0.4375rem",
                background: "var(--bg-secondary)",
                border: "0.0625rem solid var(--border)",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: "0.375rem", fontFamily: "var(--font-mono), monospace", fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                {selectedTopics.map((t, i) => (
                  <span key={t.id} style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
                    {i > 0 && <span style={{ color: "var(--text-tertiary)" }}>∩</span>}
                    <span style={{ width: "0.5rem", height: "0.5rem", borderRadius: "50%", background: t.color }} />
                    {t.short}
                  </span>
                ))}
              </span>
              <span style={{ fontFamily: "var(--font-mono), monospace", fontSize: "0.75rem", fontWeight: 500, color: "var(--accent)" }}>
                {sharedCount} {selectedTopics.length > 1 ? "shared" : sharedCount === 1 ? "paper" : "papers"}
              </span>
              <button
                onClick={onClearSelection}
                title="Clear selection"
                aria-label="Clear selection"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "1.5rem",
                  height: "1.5rem",
                  border: "none",
                  borderRadius: "0.375rem",
                  background: "transparent",
                  color: "var(--text-tertiary)",
                  cursor: "pointer",
                  fontSize: "0.875rem",
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            </div>
          )}

          <button
            type="button"
            className="app-header-labeled-action app-header-graph-compact-toggle"
            onClick={() => setCompact((c) => !c)}
            aria-label={compact ? "Expand dock" : "Collapse dock"}
            aria-pressed={compact}
            title={compact ? "Expand dock" : "Collapse dock"}
          >
            {compact ? (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M6 2H2v4M10 2h4v4M2 10v4h4M14 10v4h-4" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                <path d="M2 4h12M4 8h8M6 12h4" />
              </svg>
            )}
          </button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
          <button
            className="app-header-graph-icon-action"
            onClick={onToggleChat}
            aria-label={chatOpen ? "Close sidebar" : "Open sidebar"}
            aria-pressed={chatOpen}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "2rem",
              height: "2rem",
              background: chatOpen ? "var(--accent-soft)" : "none",
              border: `0.0625rem solid ${chatOpen ? "var(--accent)" : "var(--border)"}`,
              borderRadius: "0.4375rem",
              color: chatOpen ? "var(--accent)" : "var(--text-secondary)",
              cursor: "pointer",
              padding: 0,
              transition: "border-color 0.15s, color 0.15s, background 0.15s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "var(--accent)";
              e.currentTarget.style.color = "var(--accent)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = chatOpen ? "var(--accent)" : "var(--border)";
              e.currentTarget.style.color = chatOpen ? "var(--accent)" : "var(--text-secondary)";
            }}
          >
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="2.75" y="3.25" width="14.5" height="13.5" rx="3" />
              <path d="M8.25 3.5v13" />
            </svg>
          </button>
          <ThemeToggle />
        </div>
      </div>
    </m.header>
  );
}
