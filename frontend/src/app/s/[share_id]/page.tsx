"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { TimelineCanvas } from "@/components/TimelineCanvas";
import { ThemeToggle } from "@/components/ThemeToggle";
import { fetchSharedGraph } from "@/lib/api";
import { useHoverPreviewToggle } from "@/lib/hover-preview";
import { upgradeLegacyTimelineNoteLayout } from "@/lib/note-layout";
import { TimelineData } from "@/lib/types";
import { exportObsidianZip } from "@/lib/export";

const GITHUB_REPO_URL = "https://github.com/shresthkapoor7/sediment";

export default function SharedGraphPage() {
  const params = useParams();
  const shareId = params.share_id as string;

  const [timelineData, setTimelineData] = useState<TimelineData | null>(null);
  const [query, setQuery] = useState("");
  const [graphTitle, setGraphTitle] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [sessionActionsOpen, setSessionActionsOpen] = useState(false);
  const [isHeaderCompact, setIsHeaderCompact] = useState(false);
  const sessionActionsRef = useRef<HTMLDivElement>(null);
  const { hoverPreviewEnabled, onToggleHoverPreview } = useHoverPreviewToggle();

  useEffect(() => {
    if (!shareId) {
      setIsLoading(false);
      return;
    }

    void fetchSharedGraph(shareId)
      .then((graph) => {
        setTimelineData(upgradeLegacyTimelineNoteLayout(graph.data));
        setQuery(graph.query);
        const title = graph.metadata.title || graph.query;
        setGraphTitle(title);
        document.title = `${title} — Sediment`;
      })
      .catch(() => {
        setError("This shared timeline could not be found.");
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [shareId]);

  useEffect(() => {
    if (!sessionActionsOpen) return;

    const dismissIfOutside = (target: EventTarget | null) => {
      if (target instanceof Node && !sessionActionsRef.current?.contains(target)) {
        setSessionActionsOpen(false);
      }
    };
    const onPointerDown = (event: PointerEvent) => dismissIfOutside(event.target);
    const onFocusIn = (event: FocusEvent) => dismissIfOutside(event.target);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSessionActionsOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [sessionActionsOpen]);

  return (
    <div
      className="grain app-shell"
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <motion.header
        className={`app-header app-header-shared${isHeaderCompact ? " app-header-compact" : ""}`}
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.75rem",
          padding: "0.875rem 1.5rem",
          borderBottom: "0.0625rem solid var(--border)",
          background: "var(--bg-primary)",
          zIndex: 50,
          flexShrink: 0,
        }}
      >
        {/* Logo */}
        <a
          href="/"
          className="app-header-brand"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.625rem",
            textDecoration: "none",
            color: "var(--text-primary)",
            flexShrink: 0,
          }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round">
            <path d="M2 17l10 4 10-4" opacity="0.3" />
            <path d="M2 12l10 4 10-4" opacity="0.6" />
            <path d="M12 2L2 7l10 5 10-5L12 2z" />
          </svg>
          <span
            style={{
              fontFamily: "'Instrument Serif', Georgia, serif",
              fontSize: "1.125rem",
              fontWeight: 400,
              letterSpacing: "-0.01em",
            }}
          >
            Sediment
          </span>
        </a>

        {/* Centered query label — desktop only */}
        {graphTitle && (
          <span
            className="hide-mobile app-header-query app-header-shared-query"
            style={{
              position: "absolute",
              left: "50%",
              transform: "translateX(-50%)",
              fontSize: "0.875rem",
              color: "var(--text-secondary)",
              fontFamily: "'JetBrains Mono', monospace",
              fontWeight: 500,
              letterSpacing: "0.02em",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: "40%",
              pointerEvents: "none",
            }}
          >
            {graphTitle}
          </span>
        )}

        {/* Mobile: query label truncates between logo and buttons */}
        {graphTitle && (
          <div
            className="show-mobile app-header-query app-header-shared-query"
            style={{ flex: 1, minWidth: 0, overflow: "hidden" }}
          >
            <span
              style={{
                display: "block",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontSize: "0.875rem",
                color: "var(--text-secondary)",
                fontFamily: "'JetBrains Mono', monospace",
                fontWeight: 500,
                letterSpacing: "0.02em",
              }}
            >
              {graphTitle}
            </span>
          </div>
        )}

        {/* Right side */}
        <div className="app-header-actions" style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexShrink: 0 }}>

          <div ref={sessionActionsRef} style={{ position: "relative" }}>
            <button
              type="button"
              className="app-header-shared-action app-header-shared-icon-action"
              onClick={() => setSessionActionsOpen((open) => !open)}
              aria-label="Session actions"
              aria-expanded={sessionActionsOpen}
              title="Session actions"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <circle cx="3" cy="8" r="1.35" />
                <circle cx="8" cy="8" r="1.35" />
                <circle cx="13" cy="8" r="1.35" />
              </svg>
            </button>

            <AnimatePresence>
              {sessionActionsOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -6, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.98 }}
                  transition={{ duration: 0.15, ease: "easeOut" }}
                  style={{
                    position: "absolute",
                    top: "2.5rem",
                    right: 0,
                    width: "14rem",
                    padding: "0.875rem",
                    background: "var(--bg-secondary)",
                    border: "0.0625rem solid var(--border-hover)",
                    borderRadius: "0.625rem",
                    boxShadow: "0 0.5rem 1.5rem rgba(0,0,0,0.10), 0 0.125rem 0.375rem rgba(0,0,0,0.06)",
                    zIndex: 100,
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.125rem",
                  }}
                >
                  <p style={{ marginBottom: "0.375rem", fontSize: "0.625rem", color: "var(--text-tertiary)", fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                    Session actions
                  </p>
                  {timelineData && graphTitle && (
                    <button
                      type="button"
                      onClick={() => {
                        exportObsidianZip(timelineData, graphTitle).catch(() => alert("Export failed."));
                        setSessionActionsOpen(false);
                      }}
                      style={{ display: "flex", alignItems: "center", gap: "0.625rem", width: "100%", height: "2rem", padding: "0 0.5rem", border: "none", borderRadius: "0.375rem", background: "none", color: "var(--text-primary)", cursor: "pointer", fontFamily: "'DM Sans', sans-serif", fontSize: "0.75rem", fontWeight: 500, textAlign: "left" }}
                    >
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M8 2v9M4 7l4 4 4-4" /><path d="M2 13h12" /></svg>
                      Export
                    </button>
                  )}
                  <a
                    href={GITHUB_REPO_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setSessionActionsOpen(false)}
                    style={{ display: "flex", alignItems: "center", gap: "0.625rem", width: "100%", height: "2rem", padding: "0 0.5rem", borderRadius: "0.375rem", color: "var(--text-primary)", fontFamily: "'DM Sans', sans-serif", fontSize: "0.75rem", fontWeight: 500, textDecoration: "none" }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ color: "var(--text-tertiary)" }} aria-hidden="true"><path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.36-1.34-3.36-1.34-.45-1.15-1.1-1.46-1.1-1.46-.9-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.89 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02A9.5 9.5 0 0 1 12 6.84c.85 0 1.71.11 2.5.34 1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.69-4.57 4.94.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2z" /></svg>
                    GitHub
                  </a>
                  <ThemeToggle className="app-header-shared-session-theme" showLabel fullWidth />
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <button
            type="button"
            className="app-header-shared-action app-header-shared-icon-action app-header-shared-compact-toggle"
            onClick={() => setIsHeaderCompact((compact) => !compact)}
            aria-label={isHeaderCompact ? "Expand shared graph dock" : "Collapse shared graph dock"}
            aria-pressed={isHeaderCompact}
            title={isHeaderCompact ? "Expand dock" : "Collapse dock"}
          >
            {isHeaderCompact ? (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 2H2v4M10 2h4v4M2 10v4h4M14 10v4h-4" /></svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="M2 4h12M4 8h8M6 12h4" /></svg>
            )}
          </button>
        </div>
      </motion.header>

      <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
        {isLoading && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--text-tertiary)",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "0.8125rem",
            }}
          >
            Loading...
          </div>
        )}

        {error && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--text-tertiary)",
              fontFamily: "'DM Sans', sans-serif",
              fontSize: "0.875rem",
            }}
          >
            {error}
          </div>
        )}

        {timelineData && (
          <TimelineCanvas
            data={timelineData}
            isExpanding={false}
            onExpandNode={() => {}}
            readOnly
            hoverPreviewEnabled={hoverPreviewEnabled}
            onToggleHoverPreview={onToggleHoverPreview}
          />
        )}
      </div>
    </div>
  );
}
