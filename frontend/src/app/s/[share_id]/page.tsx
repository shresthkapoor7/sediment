"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { motion } from "framer-motion";
import { TimelineCanvas } from "@/components/TimelineCanvas";
import { ThemeToggle } from "@/components/ThemeToggle";
import { fetchSharedGraph } from "@/lib/api";
import { TimelineData } from "@/lib/types";
import { exportObsidianZip } from "@/lib/export";

export default function SharedGraphPage() {
  const params = useParams();
  const shareId = params.share_id as string;

  const [timelineData, setTimelineData] = useState<TimelineData | null>(null);
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

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
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 24px",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-primary)",
          zIndex: 50,
          flexShrink: 0,
        }}
      >
        <a
          href="/"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            textDecoration: "none",
            color: "var(--text-primary)",
            flexShrink: 0,
          }}
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--accent)"
            strokeWidth="1.5"
            strokeLinecap="round"
          >
            <path d="M2 17l10 4 10-4" opacity="0.3" />
            <path d="M2 12l10 4 10-4" opacity="0.6" />
            <path d="M12 2L2 7l10 5 10-5L12 2z" />
          </svg>
          <span
            style={{
              fontFamily: "'Instrument Serif', Georgia, serif",
              fontSize: 18,
              fontWeight: 400,
              letterSpacing: "-0.01em",
            }}
          >
            Sediment
          </span>
        </a>

        {query && (
          <span
            style={{
              position: "absolute",
              left: "50%",
              transform: "translateX(-50%)",
              fontSize: 12,
              color: "var(--text-tertiary)",
              fontFamily: "'JetBrains Mono', monospace",
              letterSpacing: "0.02em",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: "40%",
            }}
          >
            tracing: {query}
          </span>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          {timelineData && (
            <button
              onClick={() => exportObsidianZip(timelineData, query)}
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
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "var(--accent)";
                e.currentTarget.style.color = "var(--accent)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "var(--border)";
                e.currentTarget.style.color = "var(--text-secondary)";
              }}
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 2v9M4 7l4 4 4-4" />
                <path d="M2 13h12" />
              </svg>
              Export
            </button>
          )}
          <ThemeToggle />
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
              fontSize: 13,
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
              fontSize: 14,
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
