"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { SearchInput } from "@/components/SearchInput";
import { ThemeToggle } from "@/components/ThemeToggle";
import { TimelineCanvas } from "@/components/TimelineCanvas";
import {
  APIError,
  APP_VERSION,
  createSavedGraph,
  expandLineage,
  fetchSavedGraph,
  getOrCreateAnonymousUserId,
  LAST_GRAPH_ID_KEY,
  listSavedGraphs,
  registerAnonymousUser,
  searchLineage,
  shareGraph,
  updateSavedGraph,
} from "@/lib/api";
import { buildTimelineFromGraph, mergeTimelineWithGraph } from "@/lib/timeline-builder";
import { SavedGraphListItem, SeedCandidate, TimelineData, TraversalSettings } from "@/lib/types";

const DEFAULT_SETTINGS: TraversalSettings = {
  depth: 1,
  breadth: 2,
  referenceLimit: 20,
  topN: 5,
};

export default function Home() {
  const [timelineData, setTimelineData] = useState<TimelineData | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isExpanding, setIsExpanding] = useState(false);
  const [isRestoring, setIsRestoring] = useState(true);
  const [searchedQuery, setSearchedQuery] = useState("");
  const [searchError, setSearchError] = useState("");
  const [disambiguation, setDisambiguation] = useState<SeedCandidate[]>([]);
  const [settings, setSettings] = useState<TraversalSettings>(DEFAULT_SETTINGS);
  const [draftSettings, setDraftSettings] = useState<TraversalSettings>(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [graphId, setGraphId] = useState<string | null>(null);
  const [selectedSeedOpenalexId, setSelectedSeedOpenalexId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [savedGraphs, setSavedGraphs] = useState<SavedGraphListItem[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [shareState, setShareState] = useState<"idle" | "sharing" | "copied" | "error">("idle");
  const shareStateTimeoutRef = useRef<number | null>(null);
  const saveTimeoutRef = useRef<number | null>(null);
  const saveStateTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    document.title = searchedQuery
      ? `${searchedQuery} — Sediment`
      : "Sediment — Knowledge, layered.";
  }, [searchedQuery]);

  const buildMetadata = useCallback((query: string, data: TimelineData) => ({
    title: query,
    nodeCount: Object.keys(data.nodes).length,
    lastOpenedAt: new Date().toISOString(),
    appVersion: APP_VERSION,
  }), []);

  const persistLastGraphId = useCallback((nextGraphId: string | null) => {
    if (nextGraphId) {
      window.localStorage.setItem(LAST_GRAPH_ID_KEY, nextGraphId);
      return;
    }
    window.localStorage.removeItem(LAST_GRAPH_ID_KEY);
  }, []);

  useEffect(() => {
    const nextUserId = getOrCreateAnonymousUserId();
    setUserId(nextUserId);

    void registerAnonymousUser(nextUserId).catch(() => undefined);

    const lastGraphId = window.localStorage.getItem(LAST_GRAPH_ID_KEY);
    if (!lastGraphId) {
      setIsRestoring(false);
      return;
    }

    void fetchSavedGraph(lastGraphId, nextUserId)
      .then((graph) => {
        setTimelineData(graph.data);
        setSearchedQuery(graph.query);
        setGraphId(graph.id);
        setSelectedSeedOpenalexId(graph.seedPaperId ?? null);
      })
      .catch((error) => {
        if (error instanceof APIError && error.status === 404) {
          window.localStorage.removeItem(LAST_GRAPH_ID_KEY);
        }
      })
      .finally(() => {
        setIsRestoring(false);
      });
  }, []);

  useEffect(() => () => {
    if (saveTimeoutRef.current) {
      window.clearTimeout(saveTimeoutRef.current);
    }
    if (saveStateTimeoutRef.current) {
      window.clearTimeout(saveStateTimeoutRef.current);
    }
    if (shareStateTimeoutRef.current) {
      window.clearTimeout(shareStateTimeoutRef.current);
    }
  }, []);

  useEffect(() => {
    if (!historyOpen || !userId || timelineData) return;

    setIsHistoryLoading(true);
    void listSavedGraphs(userId)
      .then((graphs) => {
        setSavedGraphs(graphs);
      })
      .catch(() => {
        setSavedGraphs([]);
      })
      .finally(() => {
        setIsHistoryLoading(false);
      });
  }, [historyOpen, timelineData, userId]);

  const scheduleGraphUpdate = useCallback((nextData: TimelineData, nextQuery: string) => {
    if (!graphId || !userId) return;

    if (saveTimeoutRef.current) {
      window.clearTimeout(saveTimeoutRef.current);
    }
    if (saveStateTimeoutRef.current) {
      window.clearTimeout(saveStateTimeoutRef.current);
    }

    setSaveState("saving");

    saveTimeoutRef.current = window.setTimeout(() => {
      void updateSavedGraph(graphId, {
        userId,
        query: nextQuery,
        data: nextData,
        seedPaperId: nextData.nodes[nextData.rootId]?.paper.openalexId ?? null,
        metadata: buildMetadata(nextQuery, nextData),
      })
        .then(() => {
          setSaveState("saved");
          saveStateTimeoutRef.current = window.setTimeout(() => {
            setSaveState("idle");
          }, 1800);
        })
        .catch(() => {
          setSaveState("error");
        });
    }, 700);
  }, [buildMetadata, graphId, userId]);

  const runSearch = useCallback(async (
    query: string,
    seedOpenalexId?: string,
    searchSettings: TraversalSettings = settings,
  ) => {
    if (isExpanding) return;
    if (saveTimeoutRef.current) {
      window.clearTimeout(saveTimeoutRef.current);
    }
    if (saveStateTimeoutRef.current) {
      window.clearTimeout(saveStateTimeoutRef.current);
    }
    setIsSearching(true);
    setSearchError("");
    setDisambiguation([]);
    setSearchedQuery(query);

    try {
      const response = await searchLineage(query, seedOpenalexId, searchSettings);
      if (response.meta.mode === "needs_disambiguation") {
        setTimelineData(null);
        setGraphId(null);
        setSelectedSeedOpenalexId(null);
        setSaveState("idle");
        persistLastGraphId(null);
        setDisambiguation(response.disambiguation ?? []);
        return;
      }
      const nextTimelineData = buildTimelineFromGraph(response);
      setTimelineData(nextTimelineData);
      setSelectedSeedOpenalexId(response.seedPaperId ?? seedOpenalexId ?? null);

      if (userId) {
        try {
          setSaveState("saving");
          const savedGraph = await createSavedGraph({
            userId,
            query,
            data: nextTimelineData,
            seedPaperId: response.seedPaperId,
            metadata: buildMetadata(query, nextTimelineData),
          });
          setGraphId(savedGraph.id);
          setSaveState("saved");
          persistLastGraphId(savedGraph.id);
          saveStateTimeoutRef.current = window.setTimeout(() => {
            setSaveState("idle");
          }, 1800);
        } catch {
          setGraphId(null);
          setSaveState("error");
          persistLastGraphId(null);
        }
      }
    } catch (error) {
      setTimelineData(null);
      setGraphId(null);
      setSelectedSeedOpenalexId(null);
      setSaveState("idle");
      setSearchError(error instanceof Error ? error.message : "Search failed");
    } finally {
      setIsSearching(false);
    }
  }, [buildMetadata, isExpanding, persistLastGraphId, settings, userId]);

  const handleSearch = useCallback((query: string) => {
    void runSearch(query);
  }, [runSearch]);

  const handleSeedChoice = useCallback((openalexId: string) => {
    if (!searchedQuery) return;
    setSelectedSeedOpenalexId(openalexId);
    void runSearch(searchedQuery, openalexId);
  }, [runSearch, searchedQuery]);

  const handleReset = useCallback(() => {
    if (saveTimeoutRef.current) {
      window.clearTimeout(saveTimeoutRef.current);
    }
    if (saveStateTimeoutRef.current) {
      window.clearTimeout(saveStateTimeoutRef.current);
    }
    setTimelineData(null);
    setGraphId(null);
    setSelectedSeedOpenalexId(null);
    setSaveState("idle");
    setSearchedQuery("");
    setSearchError("");
    setDisambiguation([]);
    setDraftSettings(settings);
    persistLastGraphId(null);
  }, [persistLastGraphId, settings]);

  const handleExpandNode = useCallback(
    (nodeId: number, query: string) => {
      if (!timelineData) return;

      const sourceNode = timelineData.nodes[nodeId];
      if (!sourceNode) return;

      const normalizedQuery = query.trim().toLowerCase();
      const alreadyExpanded = timelineData.expansions.some(
        (expansion) =>
          expansion.sourceNodeId === nodeId &&
          expansion.query.trim().toLowerCase() === normalizedQuery,
      );
      if (alreadyExpanded) return;

      setIsExpanding(true);
      setSearchError("");

      void expandLineage(sourceNode.paper.openalexId, query, settings)
        .then((fragment) => {
          const nextTimelineData = mergeTimelineWithGraph(
            timelineData,
            fragment,
            nodeId,
            query,
          );

          setTimelineData(nextTimelineData);
          scheduleGraphUpdate(nextTimelineData, searchedQuery);
        })
        .catch((error) => {
          setSearchError(error instanceof Error ? error.message : "Expand failed");
        })
        .finally(() => {
          setIsExpanding(false);
        });
    },
    [scheduleGraphUpdate, searchedQuery, settings, timelineData]
  );

  const handleRefreshCurrent = useCallback(() => {
    if (!searchedQuery || isExpanding) return;
    void runSearch(searchedQuery, selectedSeedOpenalexId ?? undefined);
  }, [isExpanding, runSearch, searchedQuery, selectedSeedOpenalexId]);

  const handleShare = useCallback(async () => {
    if (!graphId || !userId || shareState === "sharing") return;

    if (shareStateTimeoutRef.current) {
      window.clearTimeout(shareStateTimeoutRef.current);
    }

    setShareState("sharing");
    try {
      const { shareUrl } = await shareGraph(graphId, userId);
      await navigator.clipboard.writeText(shareUrl);
      setShareState("copied");
      shareStateTimeoutRef.current = window.setTimeout(() => {
        setShareState("idle");
      }, 2500);
    } catch {
      setShareState("error");
      shareStateTimeoutRef.current = window.setTimeout(() => {
        setShareState("idle");
      }, 2500);
    }
  }, [graphId, shareState, userId]);

  const handleLoadSavedGraph = useCallback((savedGraphId: string) => {
    if (!userId) return;

    setIsHistoryLoading(true);
    void fetchSavedGraph(savedGraphId, userId)
      .then((graph) => {
        setTimelineData(graph.data);
        setSearchedQuery(graph.query);
        setGraphId(graph.id);
        setSelectedSeedOpenalexId(graph.seedPaperId ?? null);
        setSaveState("idle");
        persistLastGraphId(graph.id);
        setHistoryOpen(false);
      })
      .catch((error) => {
        setSearchError(error instanceof Error ? error.message : "Failed to load saved graph");
      })
      .finally(() => {
        setIsHistoryLoading(false);
      });
  }, [persistLastGraphId, userId]);

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
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
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

              {timelineData && saveState !== "idle" && (
                <motion.span
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "4px 8px",
                    borderRadius: 999,
                    border: "1px solid var(--border)",
                    background: "var(--bg-secondary)",
                    fontSize: 11,
                    color:
                      saveState === "error"
                        ? "#d16f5b"
                        : saveState === "saved"
                        ? "var(--accent)"
                        : "var(--text-tertiary)",
                    fontFamily: "'JetBrains Mono', monospace",
                    letterSpacing: "0.03em",
                  }}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: 999,
                      background:
                        saveState === "error"
                          ? "#d16f5b"
                          : saveState === "saved"
                          ? "var(--accent)"
                          : "var(--text-tertiary)",
                      opacity: saveState === "saving" ? 0.75 : 1,
                    }}
                  />
                  {saveState === "saving"
                    ? "Saving..."
                    : saveState === "saved"
                    ? "Saved"
                    : "Save failed"}
                </motion.span>
              )}

            </div>
          )}
        </AnimatePresence>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {!timelineData && (
            <motion.button
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
              onClick={() => setHistoryOpen((open) => !open)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "0 12px",
                height: 32,
                boxSizing: "border-box",
                background: historyOpen ? "var(--accent-soft)" : "none",
                border: `1px solid ${historyOpen ? "var(--accent)" : "var(--border)"}`,
                borderRadius: 7,
                color: historyOpen ? "var(--accent)" : "var(--text-secondary)",
                fontSize: 12,
                fontFamily: "'DM Sans', sans-serif",
                fontWeight: 500,
                cursor: "pointer",
                transition: "border-color 0.15s, color 0.15s, background 0.15s",
              }}
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2.5 3.5h11M2.5 8h11M2.5 12.5h11" />
                <path d="M4.5 3.5v9" opacity="0.35" />
              </svg>
              History
            </motion.button>
          )}

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

          <div style={{ position: "relative" }}>
            <button
              onClick={() => {
                setSettingsOpen((open) => {
                  if (!open) {
                    setDraftSettings(settings);
                    return true;
                  }
                  setDraftSettings(settings);
                  return false;
                });
              }}
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
                <path d="M6.5 1.5h3M6 14.5h4M3.5 5.5h9M2.5 10.5h11" />
                <circle cx="10.5" cy="5.5" r="1.5" />
                <circle cx="5.5" cy="10.5" r="1.5" />
              </svg>
              Settings
            </button>

            <AnimatePresence>
              {settingsOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -6, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.98 }}
                  transition={{ duration: 0.15, ease: "easeOut" }}
                  style={{
                    position: "absolute",
                    top: 40,
                    right: 0,
                    width: 240,
                    padding: "14px 14px 12px",
                    background: "var(--bg-secondary)",
                    border: "1px solid var(--border-hover)",
                    borderRadius: 10,
                    boxShadow: "0 8px 24px rgba(0,0,0,0.10), 0 2px 6px rgba(0,0,0,0.06)",
                    zIndex: 100,
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                  }}
                >
                  <p style={{ fontSize: 10, color: "var(--text-tertiary)", fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                    traversal settings
                  </p>
                  {[
                    { key: "depth", label: "Depth", min: 1, max: 3 },
                    { key: "breadth", label: "Breadth", min: 1, max: 5 },
                    { key: "referenceLimit", label: "Reference limit", min: 5, max: 50 },
                    { key: "topN", label: "Top N", min: 1, max: 8 },
                  ].map((item) => (
                    <label key={item.key} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "baseline",
                          fontSize: 11.5,
                          color: "var(--text-secondary)",
                          fontFamily: "'DM Sans', sans-serif",
                        }}
                      >
                        <span style={{ fontWeight: 500 }}>{item.label}</span>
                        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "var(--accent)" }}>
                          {draftSettings[item.key as keyof TraversalSettings]}
                        </span>
                      </div>
                      {(() => {
                        const val = draftSettings[item.key as keyof TraversalSettings];
                        const pct = ((val - item.min) / (item.max - item.min)) * 100;
                        const thumbSize = 13;
                        return (
                          <div style={{ position: "relative", height: 20, display: "flex", alignItems: "center" }}>
                            {/* Track background */}
                            <div style={{ position: "absolute", left: 0, right: 0, height: 3, top: "50%", transform: "translateY(-50%)", borderRadius: 2, background: "var(--bg-tertiary)" }} />
                            {/* Filled portion */}
                            <div style={{ position: "absolute", left: 0, height: 3, top: "50%", transform: "translateY(-50%)", borderRadius: 2, background: "var(--accent)", width: `${pct}%` }} />
                            {/* Thumb */}
                            <div style={{
                              position: "absolute",
                              width: thumbSize,
                              height: thumbSize,
                              top: "50%",
                              transform: "translateY(-50%)",
                              borderRadius: "50%",
                              background: "var(--accent)",
                              boxShadow: "0 1px 4px rgba(0,0,0,0.3)",
                              pointerEvents: "none",
                              left: `calc(${pct}% - ${pct / 100 * thumbSize}px)`,
                            }} />
                            {/* Invisible native input for interaction */}
                            <input
                              type="range"
                              min={item.min}
                              max={item.max}
                              value={val}
                              onChange={(e) => {
                                const value = Number(e.currentTarget.value);
                                setDraftSettings((prev) => ({ ...prev, [item.key]: value }));
                              }}
                              style={{ position: "absolute", inset: 0, width: "100%", margin: 0, opacity: 0, cursor: "pointer", height: "100%" }}
                            />
                          </div>
                        );
                      })()}
                    </label>
                  ))}
                  <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 2, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
                    <button
                      onClick={() => setDraftSettings(DEFAULT_SETTINGS)}
                      style={{
                        height: 26,
                        padding: "0 8px",
                        borderRadius: 6,
                        border: "none",
                        background: "none",
                        color: "var(--text-tertiary)",
                        cursor: "pointer",
                        fontSize: 11,
                        fontFamily: "'DM Sans', sans-serif",
                        fontWeight: 500,
                        letterSpacing: "0.01em",
                      }}
                    >
                      reset
                    </button>
                    <div style={{ flex: 1 }} />
                    <button
                      onClick={() => {
                        if (isExpanding) return;
                        setSettings(draftSettings);
                        if (searchedQuery && !isSearching) {
                          void runSearch(
                            searchedQuery,
                            selectedSeedOpenalexId ?? undefined,
                            draftSettings,
                          );
                        }
                        setSettingsOpen(false);
                      }}
                      style={{
                        height: 26,
                        padding: "0 10px",
                        borderRadius: 6,
                        border: "1px solid var(--accent)",
                        background: "var(--accent-soft)",
                        color: "var(--accent)",
                        cursor: isExpanding ? "default" : "pointer",
                        fontSize: 11,
                        fontFamily: "'DM Sans', sans-serif",
                        fontWeight: 600,
                        letterSpacing: "0.01em",
                      }}
                      disabled={isExpanding}
                    >
                      Apply
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
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
                  onClick={handleShare}
                  disabled={shareState === "sharing"}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "0 12px",
                    height: 32,
                    boxSizing: "border-box",
                    background: shareState === "copied" ? "var(--accent-soft)" : "none",
                    border: `1px solid ${shareState === "copied" ? "var(--accent)" : shareState === "error" ? "#d16f5b" : "var(--border)"}`,
                    borderRadius: 7,
                    color: shareState === "copied" ? "var(--accent)" : shareState === "error" ? "#d16f5b" : "var(--text-secondary)",
                    fontSize: 12,
                    fontFamily: "'DM Sans', sans-serif",
                    fontWeight: 500,
                    cursor: shareState === "sharing" ? "default" : "pointer",
                    transition: "border-color 0.15s, color 0.15s, background 0.15s",
                  }}
                  onMouseEnter={(e) => {
                    if (shareState === "idle") {
                      e.currentTarget.style.borderColor = "var(--accent)";
                      e.currentTarget.style.color = "var(--accent)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (shareState === "idle") {
                      e.currentTarget.style.borderColor = "var(--border)";
                      e.currentTarget.style.color = "var(--text-secondary)";
                    }
                  }}
                >
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 3a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM5 8a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM11 9a2 2 0 1 1 0 4 2 2 0 0 1 0-4z" />
                    <path d="M9 4.5l-4 3M9 11.5l-4-3" />
                  </svg>
                  {shareState === "sharing" ? "Sharing..." : shareState === "copied" ? "Copied!" : shareState === "error" ? "Failed" : "Share"}
                </motion.button>
              </>
            )}
          </AnimatePresence>

          <ThemeToggle />
        </div>
      </motion.header>

      {/* Main content */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        <AnimatePresence>
          {!timelineData && historyOpen && (
            <>
              <motion.button
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setHistoryOpen(false)}
                style={{
                  position: "absolute",
                  inset: 0,
                  background: "rgba(16, 12, 8, 0.22)",
                  border: "none",
                  zIndex: 20,
                  cursor: "pointer",
                }}
                aria-label="Close history"
              />

              <motion.aside
                initial={{ opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 24 }}
                transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                style={{
                  position: "absolute",
                  top: 14,
                  right: 14,
                  bottom: 14,
                  width: 340,
                  maxWidth: "calc(100vw - 28px)",
                  borderRadius: 20,
                  border: "1px solid var(--border-hover)",
                  background: "color-mix(in srgb, var(--bg-primary) 86%, #1e1510 14%)",
                  boxShadow: "0 18px 48px rgba(0,0,0,0.22)",
                  backdropFilter: "blur(18px)",
                  zIndex: 30,
                  display: "flex",
                  flexDirection: "column",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "18px 18px 14px",
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  <div>
                    <p
                      style={{
                        fontSize: 11,
                        color: "var(--accent)",
                        fontFamily: "'JetBrains Mono', monospace",
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                        marginBottom: 6,
                      }}
                    >
                      Saved graphs
                    </p>
                    <h2
                      style={{
                        fontSize: 22,
                        lineHeight: 1.1,
                        color: "var(--text-primary)",
                        fontFamily: "'Instrument Serif', Georgia, serif",
                        fontWeight: 400,
                      }}
                    >
                      Return to prior traces
                    </h2>
                  </div>

                  <button
                    onClick={() => setHistoryOpen(false)}
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 8,
                      border: "1px solid var(--border)",
                      background: "none",
                      color: "var(--text-tertiary)",
                      cursor: "pointer",
                      fontSize: 18,
                      lineHeight: 1,
                    }}
                    aria-label="Close history"
                  >
                    ×
                  </button>
                </div>

                <div
                  style={{
                    padding: 14,
                    overflowY: "auto",
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                  }}
                >
                  {isHistoryLoading ? (
                    <div
                      style={{
                        padding: "18px 16px",
                        borderRadius: 16,
                        border: "1px solid var(--border)",
                        background: "var(--bg-secondary)",
                        color: "var(--text-tertiary)",
                        fontSize: 13,
                      }}
                    >
                      Loading saved graphs...
                    </div>
                  ) : savedGraphs.length === 0 ? (
                    <div
                      style={{
                        padding: "18px 16px",
                        borderRadius: 16,
                        border: "1px solid var(--border)",
                        background: "var(--bg-secondary)",
                        color: "var(--text-secondary)",
                        fontSize: 13,
                        lineHeight: 1.6,
                      }}
                    >
                      No saved graphs yet. Run a search and Sediment will keep the trace here.
                    </div>
                  ) : (
                    savedGraphs.map((graph) => (
                      <button
                        key={graph.id}
                        onClick={() => handleLoadSavedGraph(graph.id)}
                        style={{
                          textAlign: "left",
                          padding: "14px 14px 13px",
                          borderRadius: 16,
                          border: "1px solid var(--border)",
                          background: "var(--bg-secondary)",
                          color: "var(--text-primary)",
                          cursor: "pointer",
                          transition: "border-color 0.15s, transform 0.15s",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.borderColor = "var(--accent)";
                          e.currentTarget.style.transform = "translateX(-2px)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.borderColor = "var(--border)";
                          e.currentTarget.style.transform = "translateX(0)";
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 12,
                            marginBottom: 8,
                          }}
                        >
                          <div
                            style={{
                              fontSize: 14,
                              fontWeight: 600,
                              lineHeight: 1.35,
                            }}
                          >
                            {graph.metadata.title || graph.query}
                          </div>
                          <div
                            style={{
                              flexShrink: 0,
                              padding: "3px 7px",
                              borderRadius: 999,
                              background: "var(--accent-soft)",
                              color: "var(--accent)",
                              fontSize: 10,
                              fontFamily: "'JetBrains Mono', monospace",
                              letterSpacing: "0.04em",
                            }}
                          >
                            {graph.metadata.nodeCount} nodes
                          </div>
                        </div>
                        <div
                          style={{
                            fontSize: 11,
                            color: "var(--text-tertiary)",
                            fontFamily: "'JetBrains Mono', monospace",
                            letterSpacing: "0.02em",
                          }}
                        >
                          updated {new Date(graph.updatedAt).toLocaleDateString()}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </motion.aside>
            </>
          )}
        </AnimatePresence>

        <AnimatePresence mode="wait">
          {!timelineData && !isSearching && !isRestoring ? (
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

              <SearchInput onSearch={handleSearch} isSearching={isSearching || isExpanding} />

              {!!searchError && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  style={{
                    marginTop: 16,
                    padding: "12px 14px",
                    borderRadius: 12,
                    border: "1px solid var(--border)",
                    background: "var(--bg-secondary)",
                    color: "var(--text-secondary)",
                    maxWidth: 520,
                    width: "100%",
                    textAlign: "left",
                    fontSize: 13,
                  }}
                >
                  {searchError}
                </motion.div>
              )}

              {disambiguation.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  style={{
                    marginTop: 16,
                    padding: 14,
                    borderRadius: 16,
                    border: "1px solid var(--border)",
                    background: "var(--bg-secondary)",
                    maxWidth: 520,
                    width: "100%",
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                  }}
                >
                  <p
                    style={{
                      fontSize: 12,
                      color: "var(--text-tertiary)",
                      fontFamily: "'JetBrains Mono', monospace",
                      letterSpacing: "0.03em",
                    }}
                  >
                    pick the intended seed paper
                  </p>
                  {disambiguation.map((candidate) => (
                    <button
                      key={candidate.openalexId}
                      onClick={() => handleSeedChoice(candidate.openalexId)}
                      style={{
                        textAlign: "left",
                        padding: "12px 14px",
                        borderRadius: 12,
                        border: "1px solid var(--border)",
                        background: "var(--bg-primary)",
                        cursor: "pointer",
                        color: "var(--text-primary)",
                      }}
                    >
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{candidate.title}</div>
                      <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 4 }}>
                        {candidate.year ?? "Unknown year"}
                      </div>
                    </button>
                  ))}
                </motion.div>
              )}

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
          ) : isSearching || isRestoring ? (
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
                {isRestoring
                  ? "restoring your last graph"
                  : `tracing lineage for "${searchedQuery}"`}
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
