"use client";

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { SearchInput } from "@/components/SearchInput";
import { ThemeToggle } from "@/components/ThemeToggle";
import { TimelineCanvas } from "@/components/TimelineCanvas";
import { generateTimeline, mergeSubLineage } from "@/lib/dummy-data";
import { TimelineData } from "@/lib/types";

export default function Home() {
  const [timelineData, setTimelineData] = useState<TimelineData | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isExpanding, setIsExpanding] = useState(false);
  const [searchedQuery, setSearchedQuery] = useState("");

  const handleSearch = useCallback((query: string) => {
    setIsSearching(true);
    setSearchedQuery(query);

    setTimeout(() => {
      setTimelineData(generateTimeline());
      setIsSearching(false);
    }, 1200);
  }, []);

  const handleReset = useCallback(() => {
    setTimelineData(null);
    setSearchedQuery("");
  }, []);

  const handleExpandNode = useCallback(
    (nodeId: number, query: string) => {
      if (!timelineData) return;
      // Don't re-expand an already expanded node
      if (timelineData.nodes[nodeId]?.expanded) return;

      setIsExpanding(true);

      setTimeout(() => {
        setTimelineData((prev) => {
          if (!prev) return prev;
          const result = mergeSubLineage(nodeId, query, prev);

          // Merge adjacency: spread new entries, then append source node's new child
          const mergedAdj: Record<number, number[]> = { ...prev.adjacency };
          for (const [fromIdStr, children] of Object.entries(result.adjacency)) {
            const fromId = Number(fromIdStr);
            if (mergedAdj[fromId]) {
              // Append without duplicating
              const existing = new Set(mergedAdj[fromId]);
              mergedAdj[fromId] = [...mergedAdj[fromId], ...children.filter(c => !existing.has(c))];
            } else {
              mergedAdj[fromId] = [...children];
            }
          }

          return {
            ...prev,
            nodes: {
              ...prev.nodes,
              [nodeId]: { ...prev.nodes[nodeId], expanded: true },
              ...result.nodes,
            },
            adjacency: mergedAdj,
            lanes: result.lanes,
            expansions: [
              ...prev.expansions,
              { sourceNodeId: nodeId, query, lane: result.lanes - 1 },
            ],
          };
        });
        setIsExpanding(false);
      }, 800);
    },
    [timelineData]
  );

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
      {/* Top bar */}
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
        <button
          onClick={handleReset}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--text-primary)",
          }}
        >
          {/* Strata icon */}
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
        </button>

        <AnimatePresence>
          {searchedQuery && (
            <motion.span
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              style={{
                fontSize: 12,
                color: "var(--text-tertiary)",
                fontFamily: "'JetBrains Mono', monospace",
                letterSpacing: "0.02em",
              }}
            >
              tracing: {searchedQuery}
            </motion.span>
          )}
        </AnimatePresence>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* Credits indicator */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              padding: "0 10px",
              height: 32,
              border: "1px solid var(--border)",
              borderRadius: 7,
              background: "var(--bg-secondary)",
              boxSizing: "border-box",
            }}
          >
            {/* Battery segments */}
            <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
              {Array.from({ length: 10 }).map((_, i) => (
                <div
                  key={i}
                  style={{
                    width: 4,
                    height: 10,
                    borderRadius: 1.5,
                    background: i < 10 ? "var(--accent)" : "var(--border)",
                    opacity: i < 10 ? 1 - i * 0.05 : 1,
                  }}
                />
              ))}
              {/* Battery tip */}
              <div style={{ width: 2, height: 5, borderRadius: "0 1px 1px 0", background: "var(--border)", marginLeft: 1 }} />
            </div>
            <span style={{ fontSize: 11, color: "var(--text-tertiary)", fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.02em" }}>
              10
            </span>
          </div>

          <AnimatePresence>
            {timelineData && (
              <>
                <motion.button
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.25 }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "0 12px",
                    height: 32,
                    boxSizing: "border-box",
                    background: "none",
                    border: "1px solid var(--border)",
                    borderRadius: 7,
                    color: "var(--text-secondary)",
                    fontSize: 12,
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
                </motion.button>

                <motion.button
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.25, delay: 0.05 }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "0 12px",
                    height: 32,
                    boxSizing: "border-box",
                    background: "none",
                    border: "1px solid var(--border)",
                    borderRadius: 7,
                    color: "var(--text-secondary)",
                    fontSize: 12,
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
                    <path d="M11 3a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM5 8a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM11 9a2 2 0 1 1 0 4 2 2 0 0 1 0-4z" />
                    <path d="M9 4.5l-4 3M9 11.5l-4-3" />
                  </svg>
                  Share
                </motion.button>
              </>
            )}
          </AnimatePresence>

          <ThemeToggle />
        </div>
      </motion.header>

      {/* Main content */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        <AnimatePresence mode="wait">
          {!timelineData && !isSearching ? (
            /* Landing state */
            <motion.div
              key="landing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, y: -20, scale: 0.98 }}
              transition={{ duration: 0.4 }}
              style={{
                height: "100%",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 40,
                padding: 24,
                position: "relative",
              }}
            >
              {/* Decorative background glow */}
              <div
                style={{
                  position: "absolute",
                  top: "30%",
                  left: "50%",
                  transform: "translate(-50%, -50%)",
                  width: 600,
                  height: 400,
                  borderRadius: "50%",
                  background:
                    "radial-gradient(ellipse, var(--accent-glow) 0%, transparent 70%)",
                  filter: "blur(80px)",
                  pointerEvents: "none",
                }}
              />

              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: 0.7,
                  ease: [0.16, 1, 0.3, 1],
                }}
                style={{ textAlign: "center", position: "relative" }}
              >
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.1, duration: 0.5 }}
                  style={{
                    fontSize: 12,
                    fontFamily: "'JetBrains Mono', monospace",
                    color: "var(--accent)",
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                    marginBottom: 16,
                  }}
                >
                  Research lineage explorer
                </motion.p>
                <h1
                  style={{
                    fontFamily: "'Instrument Serif', Georgia, serif",
                    fontSize: 56,
                    fontWeight: 400,
                    letterSpacing: "-0.03em",
                    lineHeight: 1.05,
                    marginBottom: 16,
                    color: "var(--text-primary)",
                  }}
                >
                  Knowledge,
                  <br />
                  <em style={{ fontStyle: "italic" }}>layered.</em>
                </h1>
                <p
                  style={{
                    fontSize: 16,
                    color: "var(--text-secondary)",
                    maxWidth: 440,
                    lineHeight: 1.6,
                    margin: "0 auto",
                  }}
                >
                  Trace any research concept back through time. See the papers,
                  ideas, and breakthroughs that built on each other.
                </p>
              </motion.div>

              <SearchInput onSearch={handleSearch} isSearching={isSearching} />

              {/* Decorative strata lines */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.6, duration: 1 }}
                style={{
                  position: "absolute",
                  bottom: 40,
                  left: "50%",
                  transform: "translateX(-50%)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  alignItems: "center",
                }}
              >
                {[80, 56, 36].map((w, i) => (
                  <div
                    key={i}
                    style={{
                      width: w,
                      height: 1,
                      background: "var(--border)",
                      opacity: 0.6 - i * 0.15,
                    }}
                  />
                ))}
              </motion.div>
            </motion.div>
          ) : isSearching ? (
            /* Loading state */
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              style={{
                height: "100%",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 20,
              }}
            >
              {/* Strata loading animation */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  alignItems: "center",
                }}
              >
                {[0, 1, 2, 3].map((i) => (
                  <motion.div
                    key={i}
                    initial={{ width: 0, opacity: 0 }}
                    animate={{
                      width: [0, 40 + i * 12, 20 + i * 8],
                      opacity: [0, 0.8, 0.4],
                    }}
                    transition={{
                      duration: 1.5,
                      delay: i * 0.15,
                      repeat: Infinity,
                      ease: [0.16, 1, 0.3, 1],
                    }}
                    style={{
                      height: 2,
                      borderRadius: 1,
                      background: "var(--accent)",
                    }}
                  />
                ))}
              </div>
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.3 }}
                style={{
                  fontSize: 13,
                  color: "var(--text-tertiary)",
                  fontFamily: "'JetBrains Mono', monospace",
                  letterSpacing: "0.02em",
                }}
              >
                tracing lineage for &quot;{searchedQuery}&quot;
              </motion.p>
            </motion.div>
          ) : (
            /* Timeline state */
            <motion.div
              key="timeline"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5 }}
              style={{ height: "100%", padding: 8 }}
            >
              <TimelineCanvas
                data={timelineData!}
                onExpandNode={handleExpandNode}
                isExpanding={isExpanding}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
