"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { TimelineCanvas } from "@/components/TimelineCanvas";
import { ThemeToggle } from "@/components/ThemeToggle";
import { fetchSharedGraph } from "@/lib/api";
import { TimelineData } from "@/lib/types";
import { exportObsidianZip } from "@/lib/export";

const GITHUB_REPO_URL = "https://github.com/shresthkapoor7/sediment";

export default function SharedGraphPage() {
  const params = useParams();
  const shareId = params.share_id as string;

  const [timelineData, setTimelineData] = useState<TimelineData | null>(null);
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    if (!shareId) {
      setIsLoading(false);
      return;
    }

    void fetchSharedGraph(shareId)
      .then((graph) => {
        setTimelineData(graph.data);
        setQuery(graph.query);
        document.title = `${graph.query} — Sediment`;
      })
      .catch(() => {
        setError("This shared timeline could not be found.");
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [shareId]);

  return (
    <div
      className="grain"
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <motion.header
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
        {query && (
          <span
            className="hide-mobile"
            style={{
              position: "absolute",
              left: "50%",
              transform: "translateX(-50%)",
              fontSize: "0.75rem",
              color: "var(--text-tertiary)",
              fontFamily: "'JetBrains Mono', monospace",
              letterSpacing: "0.02em",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: "40%",
              pointerEvents: "none",
            }}
          >
            tracing: {query}
          </span>
        )}

        {/* Mobile: query label truncates between logo and buttons */}
        {query && (
          <div
            className="show-mobile"
            style={{ flex: 1, minWidth: 0, overflow: "hidden" }}
          >
            <span
              style={{
                display: "block",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontSize: "0.75rem",
                color: "var(--text-tertiary)",
                fontFamily: "'JetBrains Mono', monospace",
                letterSpacing: "0.02em",
              }}
            >
              tracing: {query}
            </span>
          </div>
        )}

        {/* Right side */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexShrink: 0 }}>

          {/* Desktop buttons */}
          <div className="desktop-only" style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <a
              href={GITHUB_REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="View on GitHub"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: "2rem",
                height: "2rem",
                borderRadius: "0.4375rem",
                border: "0.0625rem solid var(--border)",
                color: "var(--text-secondary)",
                transition: "border-color 0.15s, color 0.15s",
                flexShrink: 0,
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.borderColor = "var(--accent)"; (e.currentTarget as HTMLAnchorElement).style.color = "var(--accent)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.borderColor = "var(--border)"; (e.currentTarget as HTMLAnchorElement).style.color = "var(--text-secondary)"; }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
              </svg>
            </a>

            {timelineData && query && (
              <button
                onClick={() => exportObsidianZip(timelineData, query).catch(() => alert("Export failed."))}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.375rem",
                  padding: "0 0.75rem",
                  height: "2rem",
                  boxSizing: "border-box",
                  background: "none",
                  border: "0.0625rem solid var(--border)",
                  borderRadius: "0.4375rem",
                  color: "var(--text-secondary)",
                  fontSize: "0.75rem",
                  fontFamily: "'DM Sans', sans-serif",
                  fontWeight: 500,
                  cursor: "pointer",
                  transition: "border-color 0.15s, color 0.15s",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.color = "var(--accent)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = "var(--text-secondary)"; }}
              >
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 2v9M4 7l4 4 4-4" /><path d="M2 13h12" />
                </svg>
                Export
              </button>
            )}
          </div>

          {/* Always visible: theme toggle + mobile hamburger */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
            <ThemeToggle />

            <button
              className="show-mobile"
              onClick={() => setMobileMenuOpen((o) => !o)}
              aria-label="Menu"
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: "0.3rem",
                width: "2rem",
                height: "2rem",
                background: mobileMenuOpen ? "var(--accent-soft)" : "none",
                border: `0.0625rem solid ${mobileMenuOpen ? "var(--accent)" : "var(--border)"}`,
                borderRadius: "0.4375rem",
                cursor: "pointer",
                padding: 0,
                transition: "border-color 0.15s, background 0.15s",
              }}
            >
              {mobileMenuOpen ? (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke={mobileMenuOpen ? "var(--accent)" : "var(--text-secondary)"} strokeWidth="1.75" strokeLinecap="round">
                  <path d="M2 2l10 10M12 2L2 12" />
                </svg>
              ) : (
                <svg width="14" height="12" viewBox="0 0 14 12" fill="none" stroke="var(--text-secondary)" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M1 1h12M1 6h12M1 11h12" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {/* Mobile dropdown */}
        <AnimatePresence>
          {mobileMenuOpen && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="show-mobile"
              style={{
                position: "absolute",
                top: "100%",
                left: 0,
                right: 0,
                background: "var(--bg-primary)",
                borderBottom: "0.0625rem solid var(--border)",
                boxShadow: "0 0.5rem 1.5rem rgba(0,0,0,0.12)",
                zIndex: 200,
                padding: "0.375rem 1rem 0.625rem",
                display: "flex",
                flexDirection: "column",
                gap: "0.25rem",
              }}
            >
              {timelineData && query && (
                <button
                  onClick={() => { exportObsidianZip(timelineData, query).catch(() => alert("Export failed.")); setMobileMenuOpen(false); }}
                  style={{ display: "flex", alignItems: "center", gap: "0.625rem", width: "100%", padding: "0.625rem 0.5rem", background: "none", border: "none", borderRadius: "0.5rem", color: "var(--text-primary)", fontSize: "0.875rem", fontFamily: "'DM Sans', sans-serif", fontWeight: 500, cursor: "pointer", textAlign: "left" }}
                  onTouchStart={(e) => { e.currentTarget.style.background = "var(--bg-secondary)"; }}
                  onTouchEnd={(e) => { e.currentTarget.style.background = "none"; }}
                  onTouchCancel={(e) => { e.currentTarget.style.background = "none"; }}
                >
                  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M8 2v9M4 7l4 4 4-4" /><path d="M2 13h12" />
                  </svg>
                  Export to Obsidian
                </button>
              )}

              <a
                href={GITHUB_REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setMobileMenuOpen(false)}
                style={{ display: "flex", alignItems: "center", gap: "0.625rem", padding: "0.625rem 0.5rem", borderRadius: "0.5rem", color: "var(--text-secondary)", fontSize: "0.875rem", fontFamily: "'DM Sans', sans-serif", fontWeight: 500, textDecoration: "none" }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="var(--text-tertiary)">
                  <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
                </svg>
                View source
              </a>
            </motion.div>
          )}
        </AnimatePresence>
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
          />
        )}
      </div>
    </div>
  );
}
