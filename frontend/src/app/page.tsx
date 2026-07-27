"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useState, useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { SearchInput } from "@/components/SearchInput";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LoadingLogoMark, LogoMark } from "@/components/LogoMark";
import { AppHeader } from "@/components/AppHeader";

// Graph view + clarification modal are never shown on the landing page — load their
// chunks (which pull in the chat panel, paper reader, react-markdown and KaTeX) on demand.
const TimelineCanvas = dynamic(
  () => import("@/components/TimelineCanvas").then((m) => m.TimelineCanvas),
  { ssr: false },
);
const ClarificationModal = dynamic(
  () => import("@/components/ClarificationModal").then((m) => m.ClarificationModal),
  { ssr: false },
);
// Landing scrollytelling demos are below the fold — code-split them out of the
// initial chunk and off the critical path.
const LandingDemos = dynamic(() => import("@/components/LandingDemos"), { ssr: false });
import {
  APIError,
  APP_VERSION,
  clarifyQuery,
  ClarifyResult,
  createSavedGraph,
  deleteSavedGraph,
  expandLineage,
  fetchSavedGraph,
  fetchUsage,
  getOrCreateAnonymousUserId,
  LAST_GRAPH_ID_KEY,
  listSavedGraphs,
  registerAnonymousUser,
  searchLineage,
  shareGraph,
  updateSavedGraph,
} from "@/lib/api";
import { useHoverPreviewToggle } from "@/lib/hover-preview";
import { useLandingViewport } from "@/lib/use-landing-viewport";
import { upgradeLegacyTimelineNoteLayout } from "@/lib/note-layout";
import { applyTimelineGraphAction, applyTimelineLineageChanges, applyTimelineNodeColorChanges, applyTimelineNoteChanges } from "@/lib/timeline-actions";
import {
  buildTimelineFromGraph,
  mergeTimelineWithGraph,
} from "@/lib/timeline-builder";
import {
  SavedGraphListItem,
  LineageChange,
  SeedCandidate,
  TimelineData,
  TimelineGraphAction,
  TimelineNodeColorChange,
  TimelineNoteChange,
  TraversalSettings,
} from "@/lib/types";
import { exportObsidianZip } from "@/lib/export";

const GITHUB_REPO_URL = "https://github.com/shresthkapoor7/sediment";

const DEFAULT_SETTINGS: TraversalSettings = {
  depth: 1,
  breadth: 2,
  referenceLimit: 20,
  topN: 5,
};
const DELETE_CONFIRMATION_DISABLED_KEY = "history_delete_confirmation_disabled";
const HISTORY_PAGE_SIZE = 10;


export default function Home() {
  const reduceMotion = useReducedMotion();
  const [timelineData, setTimelineData] = useState<TimelineData | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isExpanding, setIsExpanding] = useState(false);
  const [isRestoring, setIsRestoring] = useState(true);
  const [searchedQuery, setSearchedQuery] = useState("");
  const [searchError, setSearchError] = useState("");
  const [disambiguation, setDisambiguation] = useState<SeedCandidate[]>([]);
  const [traceMode, setTraceMode] = useState<"standard" | "deep">("standard");
  const [settings, setSettings] = useState<TraversalSettings>(DEFAULT_SETTINGS);
  const [draftSettings, setDraftSettings] =
    useState<TraversalSettings>(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sessionActionsOpen, setSessionActionsOpen] = useState(false);
  const { hoverPreviewEnabled, onToggleHoverPreview } = useHoverPreviewToggle();
  const [userId, setUserId] = useState<string | null>(null);
  const [graphId, setGraphId] = useState<string | null>(null);
  const [graphOwnerId, setGraphOwnerId] = useState<string | null>(null);
  const [graphTitle, setGraphTitle] = useState("");
  const [graphTitleDraft, setGraphTitleDraft] = useState("");
  const [isEditingGraphTitle, setIsEditingGraphTitle] = useState(false);
  const [selectedSeedOpenalexId, setSelectedSeedOpenalexId] = useState<
    string | null
  >(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [savedGraphs, setSavedGraphs] = useState<SavedGraphListItem[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [isHistoryLoadingMore, setIsHistoryLoadingMore] = useState(false);
  const [historyNextOffset, setHistoryNextOffset] = useState<number | null>(0);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyDeletedCount, setHistoryDeletedCount] = useState(0);
  const [deletingGraphId, setDeletingGraphId] = useState<string | null>(null);
  const [pendingDeleteGraph, setPendingDeleteGraph] = useState<SavedGraphListItem | null>(null);
  const [skipDeleteConfirmation, setSkipDeleteConfirmation] = useState(false);
  const [neverShowDeleteConfirmationAgain, setNeverShowDeleteConfirmationAgain] = useState(false);
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [shareState, setShareState] = useState<
    "idle" | "sharing" | "copied" | "error"
  >("idle");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [globalChatOpen, setGlobalChatOpen] = useState(false);
  const [closePaperPanelSignal, setClosePaperPanelSignal] = useState(0);
  const [credits, setCredits] = useState<number>(10);
  const [showCreditsHint, setShowCreditsHint] = useState(false);
  const [isClarifying, setIsClarifying] = useState(false);
  const [clarification, setClarification] = useState<ClarifyResult | null>(
    null,
  );
  const clarifyRequestIdRef = useRef(0);
  const shareStateTimeoutRef = useRef<number | null>(null);
  const saveTimeoutRef = useRef<number | null>(null);
  const saveStateTimeoutRef = useRef<number | null>(null);
  const graphTitleInputRef = useRef<HTMLInputElement | null>(null);
  const graphTitleRef = useRef("");
  const graphTitleEditCanceledRef = useRef(false);
  const isSavingGraphTitleRef = useRef(false);
  const landingScrollRef = useRef<HTMLDivElement | null>(null);
  // Expose the landing scroll container to AppHeader as state (via a stable
  // callback ref) so the header can attach its own scroll listener the moment
  // the container mounts — keeping scroll-driven compaction out of Home's renders.
  const [landingScrollEl, setLandingScrollEl] = useState<HTMLDivElement | null>(null);
  const setLandingScrollRef = useCallback((node: HTMLDivElement | null) => {
    landingScrollRef.current = node;
    setLandingScrollEl(node);
  }, []);
  const landingSearchRef = useRef<HTMLDivElement | null>(null);
  const savedGraphIdsRef = useRef<Set<string>>(new Set());
  const { compact, mobile } = useLandingViewport();

  useEffect(() => {
    const title = graphTitle || searchedQuery;
    document.title = title
      ? `Sediment | ${title}`
      : "Sediment | Knowledge, layered.";
  }, [graphTitle, searchedQuery]);

  useEffect(() => {
    graphTitleRef.current = graphTitle;
  }, [graphTitle]);

  const buildMetadata = useCallback(
    (query: string, data: TimelineData, title = query) => ({
      title,
      nodeCount: Object.keys(data.nodes).length,
      lastOpenedAt: new Date().toISOString(),
      appVersion: APP_VERSION,
    }),
    [],
  );

  const persistLastGraphId = useCallback((nextGraphId: string | null) => {
    if (nextGraphId) {
      window.localStorage.setItem(LAST_GRAPH_ID_KEY, nextGraphId);
      return;
    }
    window.localStorage.removeItem(LAST_GRAPH_ID_KEY);
  }, []);

  const refreshCredits = useCallback(() => {
    void fetchUsage()
      .then((data) => setCredits(data.segments))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    refreshCredits();
  }, [refreshCredits]);

  useEffect(() => {
    setSkipDeleteConfirmation(
      window.localStorage.getItem(DELETE_CONFIRMATION_DISABLED_KEY) === "true",
    );

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
        setTimelineData(upgradeLegacyTimelineNoteLayout(graph.data));
        setSearchedQuery(graph.query);
        setGraphId(graph.id);
        setGraphOwnerId(graph.userId);
        setGraphTitle(graph.metadata.title || graph.query);
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

  useEffect(
    () => () => {
      if (saveTimeoutRef.current) {
        window.clearTimeout(saveTimeoutRef.current);
      }
      if (saveStateTimeoutRef.current) {
        window.clearTimeout(saveStateTimeoutRef.current);
      }
      if (shareStateTimeoutRef.current) {
        window.clearTimeout(shareStateTimeoutRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (!historyOpen || !userId || timelineData) return;

    setIsHistoryLoading(true);
    setHistoryDeletedCount(0);
    void listSavedGraphs(userId, { limit: HISTORY_PAGE_SIZE, offset: 0 })
      .then((page) => {
        setSavedGraphs(page.items);
        setHistoryHasMore(page.hasMore);
        setHistoryNextOffset(page.nextOffset ?? null);
      })
      .catch(() => {
        setSavedGraphs([]);
        setHistoryHasMore(false);
        setHistoryNextOffset(null);
      })
      .finally(() => {
        setIsHistoryLoading(false);
      });
  }, [historyOpen, timelineData, userId]);

  useEffect(() => {
    savedGraphIdsRef.current = new Set(savedGraphs.map((graph) => graph.id));
  }, [savedGraphs]);

  const loadMoreHistory = useCallback(() => {
    if (!userId || isHistoryLoading || isHistoryLoadingMore || historyNextOffset === null) return;
    setIsHistoryLoadingMore(true);
    const adjustedOffset = Math.max(0, historyNextOffset - historyDeletedCount);
    void listSavedGraphs(userId, { limit: HISTORY_PAGE_SIZE, offset: adjustedOffset })
      .then((page) => {
        setSavedGraphs((current) => {
          const existing = new Set(current.map((graph) => graph.id));
          return [
            ...current,
            ...page.items.filter((graph) => !existing.has(graph.id)),
          ];
        });
        setHistoryHasMore(page.hasMore);
        setHistoryNextOffset(page.nextOffset ?? null);
        setHistoryDeletedCount(0);
      })
      .catch(() => undefined)
      .finally(() => {
        setIsHistoryLoadingMore(false);
      });
  }, [historyDeletedCount, historyNextOffset, isHistoryLoading, isHistoryLoadingMore, userId]);

  const scheduleGraphUpdate = useCallback(
    (nextData: TimelineData, nextQuery: string) => {
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
          seedPaperId: selectedSeedOpenalexId ?? nextData.nodes[nextData.rootId]?.paper.openalexId ?? null,
          metadata: buildMetadata(nextQuery, nextData, graphTitleRef.current || nextQuery),
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
    },
    [buildMetadata, graphId, selectedSeedOpenalexId, userId],
  );

  const canEditGraphTitle = Boolean(
    timelineData && graphId && userId && graphOwnerId === userId,
  );

  const startGraphTitleEdit = useCallback(() => {
    if (!canEditGraphTitle) return;
    graphTitleEditCanceledRef.current = false;
    setGraphTitleDraft(graphTitle || searchedQuery);
    setIsEditingGraphTitle(true);
    window.requestAnimationFrame(() => {
      graphTitleInputRef.current?.focus();
      graphTitleInputRef.current?.select();
    });
  }, [canEditGraphTitle, graphTitle, searchedQuery]);

  const cancelGraphTitleEdit = useCallback(() => {
    graphTitleEditCanceledRef.current = true;
    setGraphTitleDraft(graphTitle || searchedQuery);
    setIsEditingGraphTitle(false);
  }, [graphTitle, searchedQuery]);

  const saveGraphTitle = useCallback(() => {
    if (graphTitleEditCanceledRef.current) {
      graphTitleEditCanceledRef.current = false;
      return;
    }
    if (
      isSavingGraphTitleRef.current ||
      !canEditGraphTitle ||
      !graphId ||
      !userId ||
      !timelineData
    ) {
      return;
    }

    const nextTitle = graphTitleDraft.trim();
    if (!nextTitle) {
      cancelGraphTitleEdit();
      return;
    }

    setIsEditingGraphTitle(false);
    if (nextTitle === graphTitle) return;

    const previousTitle = graphTitle;
    graphTitleRef.current = nextTitle;
    setGraphTitle(nextTitle);
    setSaveState("saving");
    isSavingGraphTitleRef.current = true;

    void updateSavedGraph(graphId, {
      userId,
      metadata: buildMetadata(searchedQuery, timelineData, nextTitle),
    })
      .then(() => {
        setSaveState("saved");
        saveStateTimeoutRef.current = window.setTimeout(() => {
          setSaveState("idle");
        }, 1800);
      })
      .catch(() => {
        graphTitleRef.current = previousTitle;
        setGraphTitle(previousTitle);
        setSaveState("error");
      })
      .finally(() => {
        isSavingGraphTitleRef.current = false;
      });
  }, [
    buildMetadata,
    canEditGraphTitle,
    cancelGraphTitleEdit,
    graphId,
    graphTitle,
    graphTitleDraft,
    searchedQuery,
    timelineData,
    userId,
  ]);

  const runSearch = useCallback(
    async (
      query: string,
      seedOpenalexId?: string,
      searchSettings: TraversalSettings = settings,
      requestQuery: string = query,
      selectedTraceMode: "standard" | "deep" = traceMode,
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
      setGraphTitle(query);
      setGraphTitleDraft("");
      setIsEditingGraphTitle(false);
      setGraphOwnerId(null);

      try {
        let response = await searchLineage(
          requestQuery,
          seedOpenalexId,
          searchSettings,
          selectedTraceMode,
        );
        const normalizedDisplayQuery = query.trim().toLowerCase();
        const normalizedRequestQuery = requestQuery.trim().toLowerCase();
        if (
          response.papers.length === 0 &&
          normalizedRequestQuery &&
          normalizedRequestQuery !== normalizedDisplayQuery
        ) {
          response = await searchLineage(query, seedOpenalexId, searchSettings, selectedTraceMode);
        }
        if (response.meta.mode === "needs_disambiguation") {
          setTimelineData(null);
          setGraphId(null);
          setGraphOwnerId(null);
          setSelectedSeedOpenalexId(null);
          setSaveState("idle");
          persistLastGraphId(null);
          setDisambiguation(response.disambiguation ?? []);
          return;
        }
        if (response.meta.mode === "no_results" || response.papers.length === 0) {
          setTimelineData(null);
          setGraphId(null);
          setGraphOwnerId(null);
          setSelectedSeedOpenalexId(null);
          setGlobalChatOpen(false);
          setSaveState("idle");
          persistLastGraphId(null);
          setSearchError("I couldn’t find papers for that full query. Try one concept or paper title at a time.");
          return;
        }
        const nextTimelineData = buildTimelineFromGraph(response);
        const nextSeedPaperId =
          response.seedPaperId ??
          seedOpenalexId ??
          nextTimelineData.nodes[nextTimelineData.rootId]?.paper.openalexId ??
          null;
        setTimelineData(nextTimelineData);
        setSelectedSeedOpenalexId(nextSeedPaperId);
        setGlobalChatOpen(Boolean(nextTimelineData.traceSummary));

        if (userId) {
          try {
            setSaveState("saving");
            const savedGraph = await createSavedGraph({
              userId,
              query,
              data: nextTimelineData,
              seedPaperId: nextSeedPaperId,
              metadata: buildMetadata(query, nextTimelineData),
            });
            setGraphId(savedGraph.id);
            setGraphOwnerId(savedGraph.userId);
            setGraphTitle(savedGraph.metadata.title || query);
            setSaveState("saved");
            persistLastGraphId(savedGraph.id);
            saveStateTimeoutRef.current = window.setTimeout(() => {
              setSaveState("idle");
            }, 1800);
          } catch {
            setGraphId(null);
            setGraphOwnerId(null);
            setSaveState("error");
            persistLastGraphId(null);
          }
        }
      } catch (error) {
        setTimelineData(null);
        setGraphId(null);
        setGraphOwnerId(null);
        setSelectedSeedOpenalexId(null);
        setSaveState("idle");
        setSearchError(
          error instanceof Error ? error.message : "Search failed",
        );
      } finally {
        setIsSearching(false);
        refreshCredits();
      }
    },
    [
      buildMetadata,
      isExpanding,
      persistLastGraphId,
      refreshCredits,
      settings,
      traceMode,
      userId,
    ],
  );

  const handleSearch = useCallback(
    async (query: string) => {
      const requestId = ++clarifyRequestIdRef.current;
      setClarification(null);
      setSearchError("");
      setIsClarifying(true);
      try {
        const result = await clarifyQuery(query);
        if (clarifyRequestIdRef.current !== requestId) {
          return;
        }
        if (result.needsClarification) {
          setClarification(result);
        } else {
          void runSearch(
            query,
            undefined,
            settings,
            result.refinedQuery ?? query,
          );
        }
      } catch (error) {
        if (clarifyRequestIdRef.current !== requestId) {
          return;
        }
        if (error instanceof APIError && error.status === 429) {
          setSearchError(error.message);
          return;
        }
        void runSearch(query);
      } finally {
        if (clarifyRequestIdRef.current === requestId) {
          setIsClarifying(false);
        }
      }
    },
    [runSearch, settings],
  );

  const handleSeedChoice = useCallback(
    (openalexId: string) => {
      if (!searchedQuery) return;
      setSelectedSeedOpenalexId(openalexId);
      void runSearch(searchedQuery, openalexId);
    },
    [runSearch, searchedQuery],
  );

  const handleScrollToSearch = useCallback(() => {
    const container = landingScrollRef.current;
    if (!container) return;

    container.scrollTo({
      top: 0,
      behavior: "instant",
    });

    const input = landingSearchRef.current?.querySelector("input");
    if (input instanceof HTMLInputElement) {
      input.focus();
    }
  }, []);

  const handleReset = useCallback(() => {
    clarifyRequestIdRef.current += 1;
    if (saveTimeoutRef.current) {
      window.clearTimeout(saveTimeoutRef.current);
    }
    if (saveStateTimeoutRef.current) {
      window.clearTimeout(saveStateTimeoutRef.current);
    }
    setTimelineData(null);
    setGraphId(null);
    setGraphOwnerId(null);
    setGraphTitle("");
    setGraphTitleDraft("");
    setIsEditingGraphTitle(false);
    setSelectedSeedOpenalexId(null);
    setSaveState("idle");
    setSearchedQuery("");
    setSearchError("");
    setDisambiguation([]);
    setClarification(null);
    setGlobalChatOpen(false);
    setSessionActionsOpen(false);
    setSettingsOpen(false);
    setClosePaperPanelSignal((value) => value + 1);
    setDraftSettings(settings);
    persistLastGraphId(null);
  }, [persistLastGraphId, settings]);

  const handleToggleGlobalChat = useCallback(() => {
    setClosePaperPanelSignal((value) => value + 1);
    setGlobalChatOpen((open) => !open);
  }, []);

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
          setSearchError(
            error instanceof Error ? error.message : "Expand failed",
          );
        })
        .finally(() => {
          setIsExpanding(false);
          refreshCredits();
        });
    },
    [
      refreshCredits,
      scheduleGraphUpdate,
      searchedQuery,
      settings,
      timelineData,
    ],
  );

  const handleTimelineGraphAction = useCallback(
    (action: TimelineGraphAction) => {
      if (!timelineData || isExpanding) return;
      const nextTimelineData = applyTimelineGraphAction(timelineData, action, {
        lockedOpenalexIds: selectedSeedOpenalexId ? [selectedSeedOpenalexId] : [],
      });
      if (nextTimelineData === timelineData) return;
      setTimelineData(nextTimelineData);
      scheduleGraphUpdate(nextTimelineData, searchedQuery);
    },
    [isExpanding, scheduleGraphUpdate, searchedQuery, selectedSeedOpenalexId, timelineData],
  );

  const handleTimelineLineageChanges = useCallback(
    (changes: LineageChange[]) => {
      if (!timelineData || isExpanding || changes.length === 0) return;
      const nextTimelineData = applyTimelineLineageChanges(timelineData, changes, {
        lockedOpenalexIds: selectedSeedOpenalexId ? [selectedSeedOpenalexId] : [],
      });
      if (nextTimelineData === timelineData) return;
      setTimelineData(nextTimelineData);
      scheduleGraphUpdate(nextTimelineData, searchedQuery);
    },
    [isExpanding, scheduleGraphUpdate, searchedQuery, selectedSeedOpenalexId, timelineData],
  );

  const handleTimelineNoteChanges = useCallback(
    (changes: TimelineNoteChange[]) => {
      if (!timelineData || isExpanding || changes.length === 0) return;
      const nextTimelineData = applyTimelineNoteChanges(timelineData, changes);
      if (nextTimelineData === timelineData) return;
      setTimelineData(nextTimelineData);
      scheduleGraphUpdate(nextTimelineData, searchedQuery);
    },
    [isExpanding, scheduleGraphUpdate, searchedQuery, timelineData],
  );

  const handleTimelineNodeColorChanges = useCallback(
    (changes: TimelineNodeColorChange[]) => {
      if (!timelineData || isExpanding || changes.length === 0) return;
      const nextTimelineData = applyTimelineNodeColorChanges(timelineData, changes);
      if (nextTimelineData === timelineData) return;
      setTimelineData(nextTimelineData);
      scheduleGraphUpdate(nextTimelineData, searchedQuery);
    },
    [isExpanding, scheduleGraphUpdate, searchedQuery, timelineData],
  );

  const handleRefreshCurrent = useCallback(() => {
    if (!searchedQuery || isExpanding) return;
    void runSearch(searchedQuery, selectedSeedOpenalexId ?? undefined);
  }, [isExpanding, runSearch, searchedQuery, selectedSeedOpenalexId]);

  const handleExport = useCallback(() => {
    if (!timelineData || !searchedQuery) return;
    exportObsidianZip(timelineData, searchedQuery).catch((err) => {
      console.error("Export failed:", err);
      alert("Export failed. Please try again.");
    });
  }, [timelineData, searchedQuery]);

  const handleShare = useCallback(async () => {
    if (
      !graphId ||
      !userId ||
      shareState === "sharing" ||
      saveState === "saving"
    )
      return;

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

  const handleLoadSavedGraph = useCallback(
    (savedGraphId: string) => {
      if (!userId) return;

      setIsHistoryLoading(true);
      void fetchSavedGraph(savedGraphId, userId)
        .then((graph) => {
          setTimelineData(upgradeLegacyTimelineNoteLayout(graph.data));
          setSearchedQuery(graph.query);
          setGraphId(graph.id);
          setGraphOwnerId(graph.userId);
          setGraphTitle(graph.metadata.title || graph.query);
          setSelectedSeedOpenalexId(graph.seedPaperId ?? null);
          setSaveState("idle");
          persistLastGraphId(graph.id);
          setHistoryOpen(false);
        })
        .catch((error) => {
          setSearchError(
            error instanceof Error
              ? error.message
              : "Failed to load saved graph",
          );
        })
        .finally(() => {
          setIsHistoryLoading(false);
        });
    },
    [persistLastGraphId, userId],
  );

  const handleDeleteSavedGraph = useCallback((savedGraphId: string) => {
    if (!userId || deletingGraphId) return;

    setDeletingGraphId(savedGraphId);
    setSearchError("");

    void deleteSavedGraph(savedGraphId, userId)
      .then(() => {
        if (savedGraphIdsRef.current.has(savedGraphId)) {
          setHistoryDeletedCount((count) => count + 1);
        }
        setSavedGraphs((current) => current.filter((graph) => graph.id !== savedGraphId));
        if (graphId === savedGraphId) {
          setTimelineData(null);
          setGraphId(null);
          setSelectedSeedOpenalexId(null);
          setSaveState("idle");
          persistLastGraphId(null);
        } else if (window.localStorage.getItem(LAST_GRAPH_ID_KEY) === savedGraphId) {
          persistLastGraphId(null);
        }
      })
      .catch((error) => {
        setSearchError(error instanceof Error ? error.message : "Failed to delete saved graph");
      })
      .finally(() => {
        setDeletingGraphId(null);
      });
  }, [deletingGraphId, graphId, persistLastGraphId, userId]);

  const requestDeleteSavedGraph = useCallback((graph: SavedGraphListItem) => {
    if (skipDeleteConfirmation) {
      void handleDeleteSavedGraph(graph.id);
      return;
    }

    setNeverShowDeleteConfirmationAgain(false);
    setPendingDeleteGraph(graph);
  }, [handleDeleteSavedGraph, skipDeleteConfirmation]);

  const confirmDeleteSavedGraph = useCallback(() => {
    if (!pendingDeleteGraph) return;

    if (neverShowDeleteConfirmationAgain) {
      window.localStorage.setItem(DELETE_CONFIRMATION_DISABLED_KEY, "true");
      setSkipDeleteConfirmation(true);
    }

    const graphIdToDelete = pendingDeleteGraph.id;
    setPendingDeleteGraph(null);
    void handleDeleteSavedGraph(graphIdToDelete);
  }, [handleDeleteSavedGraph, neverShowDeleteConfirmationAgain, pendingDeleteGraph]);

  const cancelDeleteSavedGraph = useCallback(() => {
    setPendingDeleteGraph(null);
    setNeverShowDeleteConfirmationAgain(false);
  }, []);

  return (
    <div
      className={`app-shell${timelineData ? " canvas-shell" : " landing-shell"}${isSearching || isRestoring || isClarifying ? " graph-loading-shell" : ""}`}
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Top bar */}
      <AppHeader
        timelineData={timelineData}
        mobile={mobile}
        searchedQuery={searchedQuery}
        graphTitle={graphTitle}
        graphTitleDraft={graphTitleDraft}
        isEditingGraphTitle={isEditingGraphTitle}
        canEditGraphTitle={canEditGraphTitle}
        graphTitleInputRef={graphTitleInputRef}
        isSearching={isSearching}
        isExpanding={isExpanding}
        historyOpen={historyOpen}
        settingsOpen={settingsOpen}
        settings={settings}
        draftSettings={draftSettings}
        defaultSettings={DEFAULT_SETTINGS}
        sessionActionsOpen={sessionActionsOpen}
        mobileMenuOpen={mobileMenuOpen}
        globalChatOpen={globalChatOpen}
        credits={credits}
        showCreditsHint={showCreditsHint}
        shareState={shareState}
        selectedSeedOpenalexId={selectedSeedOpenalexId}
        landingScrollEl={landingScrollEl}
        setHistoryOpen={setHistoryOpen}
        setSettingsOpen={setSettingsOpen}
        setSettings={setSettings}
        setDraftSettings={setDraftSettings}
        setSessionActionsOpen={setSessionActionsOpen}
        setMobileMenuOpen={setMobileMenuOpen}
        setShowCreditsHint={setShowCreditsHint}
        setGraphTitleDraft={setGraphTitleDraft}
        handleReset={handleReset}
        handleExport={handleExport}
        handleShare={handleShare}
        handleToggleGlobalChat={handleToggleGlobalChat}
        startGraphTitleEdit={startGraphTitleEdit}
        saveGraphTitle={saveGraphTitle}
        cancelGraphTitleEdit={cancelGraphTitleEdit}
        runSearch={runSearch}
      />

      {/* Clarification modal */}
      <AnimatePresence>
        {clarification?.needsClarification && (
          <ClarificationModal
            key="clarification-modal"
            question={
              clarification.question ??
              "What research area are you interested in?"
            }
            options={clarification.options ?? []}
            onSelect={(query) => {
              setClarification(null);
              void runSearch(query);
            }}
            onDismiss={() => setClarification(null)}
          />
        )}
      </AnimatePresence>

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
                  background: "rgba(10, 10, 12, 0.45)",
                  border: "none",
                  zIndex: 20,
                  cursor: "pointer",
                  backdropFilter: "blur(0.125rem)",
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
                  top: "0.875rem",
                  right: "0.875rem",
                  bottom: "0.875rem",
                  width: "21.25rem",
                  maxWidth: "calc(100vw - 1.75rem)",
                  borderRadius: "0.5rem",
                  border: "0.0625rem solid var(--border)",
                  background:
                    "color-mix(in srgb, var(--bg-primary) 92%, transparent)",
                  boxShadow: "0 0.75rem 2rem rgba(0,0,0,0.16)",
                  backdropFilter: "blur(0.75rem)",
                  zIndex: 30,
                  display: "flex",
                  flexDirection: "column",
                  overflow: "hidden",
                }}
              >
                <button
                  type="button"
                  onClick={() => setHistoryOpen(false)}
                  aria-label="Close history"
                  style={{
                    position: "absolute",
                    top: 0,
                    right: 0,
                    zIndex: 100,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: "4.25rem",
                    height: "4.75rem",
                    color: "var(--text-tertiary)",
                    cursor: "pointer",
                    fontSize: "1.25rem",
                    lineHeight: 1,
                    textDecoration: "none",
                    border: "none",
                    padding: 0,
                    background: "transparent",
                  }}
                >
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: "2rem",
                      height: "2rem",
                      borderRadius: "0.25rem",
                      border: "0.0625rem solid var(--border)",
                      background: "var(--bg-primary)",
                    }}
                  >
                    ×
                  </span>
                </button>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "1.125rem 1.125rem 0.875rem",
                    borderBottom: "0.0625rem solid var(--border)",
                  }}
                >
                  <div>
                    <p
                      style={{
                        fontSize: "0.6875rem",
                        color: "var(--accent)",
                        fontFamily: "var(--font-mono), monospace",
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                        marginBottom: "0.375rem",
                      }}
                    >
                      Saved graphs
                    </p>
                    <h2
                      style={{
                        fontSize: "1.375rem",
                        lineHeight: 1.1,
                        color: "var(--text-primary)",
                        fontFamily: "var(--font-sans), sans-serif",
                        fontWeight: 600,
                      }}
                    >
                      Return to prior traces
                    </h2>
                  </div>

                </div>

                <div
                  style={{
                    padding: "0.875rem",
                    overflowY: "auto",
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.625rem",
                  }}
                >
                  {isHistoryLoading ? (
                    <div
                      style={{
                        padding: "1.125rem 1rem",
                        borderRadius: "0.375rem",
                        border: "0.0625rem solid var(--border)",
                        background: "var(--bg-secondary)",
                        color: "var(--text-tertiary)",
                        fontSize: "0.8125rem",
                      }}
                    >
                      Loading saved graphs...
                    </div>
                  ) : savedGraphs.length === 0 && !historyHasMore ? (
                    <div
                      style={{
                        padding: "1.125rem 1rem",
                        borderRadius: "0.375rem",
                        border: "0.0625rem solid var(--border)",
                        background: "var(--bg-secondary)",
                        color: "var(--text-secondary)",
                        fontSize: "0.8125rem",
                        lineHeight: 1.6,
                      }}
                    >
                      No saved graphs yet. Run a search and Sediment will keep
                      the trace here.
                    </div>
                  ) : (
                    <>
                    {savedGraphs.map((graph) => (
                      <div
                        key={graph.id}
                        style={{
                          textAlign: "left",
                          padding: "0.875rem 0.875rem 0.8125rem",
                          borderRadius: "0.375rem",
                          border: "0.0625rem solid var(--border)",
                          background: "var(--bg-secondary)",
                          color: "var(--text-primary)",
                          transition: "border-color 0.12s, background 0.12s",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.borderColor = "var(--border-hover)";
                          e.currentTarget.style.background = "var(--bg-tertiary)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.borderColor = "var(--border)";
                          e.currentTarget.style.background = "var(--bg-secondary)";
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: "0.75rem",
                            marginBottom: "0.5rem",
                          }}
                        >
                          <button
                            onClick={() => handleLoadSavedGraph(graph.id)}
                            style={{
                              flex: 1,
                              textAlign: "left",
                              background: "none",
                              border: "none",
                              padding: 0,
                              color: "inherit",
                              cursor: deletingGraphId ? "default" : "pointer",
                            }}
                            disabled={!!deletingGraphId}
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
                          </button>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "0.5rem",
                            }}
                          >
                            <div
                              style={{
                                flexShrink: 0,
                                padding: "3px 7px",
                                borderRadius: 2,
                                background: "var(--accent-soft)",
                                color: "var(--accent)",
                                fontSize: 10,
                                fontFamily: "var(--font-mono), monospace",
                                letterSpacing: "0.04em",
                              }}
                            >
                              {graph.metadata.nodeCount} nodes
                            </div>
                            <button
                              onClick={() => requestDeleteSavedGraph(graph)}
                              disabled={deletingGraphId !== null}
                              aria-label={`Delete ${graph.metadata.title || graph.query}`}
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                height: 22,
                                padding: "0 7px",
                                borderRadius: 4,
                                border: "none",
                                background: deletingGraphId === graph.id ? "var(--bg-tertiary)" : "color-mix(in srgb, var(--cat-rose) 12%, transparent)",
                                color: deletingGraphId === graph.id ? "var(--text-tertiary)" : "var(--cat-rose)",
                                cursor: deletingGraphId ? "default" : "pointer",
                                flexShrink: 0,
                                transition: "background 0.12s, color 0.12s",
                              }}
                              onMouseEnter={(e) => {
                                if (deletingGraphId) return;
                                e.currentTarget.style.background = "color-mix(in srgb, var(--cat-rose) 22%, transparent)";
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.background = deletingGraphId === graph.id ? "var(--bg-tertiary)" : "color-mix(in srgb, var(--cat-rose) 12%, transparent)";
                              }}
                            >
                              {deletingGraphId === graph.id ? (
                                <span
                                  style={{
                                    fontSize: 10,
                                    fontFamily: "var(--font-mono), monospace",
                                    letterSpacing: "0.04em",
                                  }}
                                >
                                  ...
                                </span>
                              ) : (
                                <svg
                                  width="11"
                                  height="11"
                                  viewBox="0 0 16 16"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="1.5"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                >
                                  <path d="M2.5 4h11" />
                                  <path d="M6 1.75h4" />
                                  <path d="M5 4v8.25c0 .55.45 1 1 1h4c.55 0 1-.45 1-1V4" />
                                  <path d="M6.75 6.25v4.5M9.25 6.25v4.5" />
                                </svg>
                              )}
                            </button>
                          </div>
                        </div>
                        <button
                          onClick={() => handleLoadSavedGraph(graph.id)}
                          style={{
                            width: "100%",
                            textAlign: "left",
                            background: "none",
                            border: "none",
                            padding: 0,
                            color: "inherit",
                            cursor: deletingGraphId ? "default" : "pointer",
                          }}
                          disabled={!!deletingGraphId}
                        >
                          <div
                            style={{
                              flexShrink: 0,
                              fontSize: "0.6875rem",
                              color: "var(--text-tertiary)",
                              fontFamily: "var(--font-mono), monospace",
                              letterSpacing: "0.02em",
                            }}
                          >
                            updated {new Date(graph.updatedAt).toLocaleDateString()}
                          </div>
                        </button>
                      </div>
                    ))}
                    {historyHasMore && (
                      <button
                        onClick={loadMoreHistory}
                        disabled={isHistoryLoadingMore}
                        style={{
                          width: "100%",
                          padding: "0.75rem 0.875rem",
                          borderRadius: "0.25rem",
                          border: "0.0625rem solid var(--border)",
                          background: "var(--bg-secondary)",
                          color: isHistoryLoadingMore ? "var(--text-tertiary)" : "var(--accent)",
                          cursor: isHistoryLoadingMore ? "default" : "pointer",
                          fontSize: "0.75rem",
                          fontFamily: "var(--font-mono), monospace",
                          letterSpacing: "0.04em",
                        }}
                      >
                        {isHistoryLoadingMore ? "Loading..." : "Load more"}
                      </button>
                    )}
                    </>
                  )}
                </div>
              </motion.aside>
            </>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {pendingDeleteGraph && (
            <>
              <motion.button
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={cancelDeleteSavedGraph}
                style={{
                  position: "fixed",
                  inset: 0,
                  background: "rgba(10, 10, 12, 0.55)",
                  border: "none",
                  zIndex: 40,
                  cursor: "pointer",
                  backdropFilter: "blur(0.125rem)",
                }}
                aria-label="Close delete confirmation"
              />

              <motion.div
                role="dialog"
                aria-modal="true"
                aria-labelledby="delete-graph-dialog-title"
                initial={{ opacity: 0, y: 12, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 12, scale: 0.98 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                style={{
                  position: "fixed",
                  inset: 0,
                  width: "min(26.25rem, calc(100vw - 2rem))",
                  height: "fit-content",
                  maxHeight: "calc(100dvh - 2rem)",
                  margin: "auto",
                  padding: 20,
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "var(--bg-primary)",
                  boxShadow: "0 1rem 2.5rem rgba(0,0,0,0.16)",
                  zIndex: 50,
                  display: "flex",
                  flexDirection: "column",
                  gap: 14,
                  overflowY: "auto",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <p
                    style={{
                      fontSize: 11,
                      color: "var(--accent)",
                      fontFamily: "var(--font-mono), monospace",
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                    }}
                  >
                    Confirm deletion
                  </p>
                  <h3
                    id="delete-graph-dialog-title"
                    style={{
                      fontSize: 24,
                      lineHeight: 1.1,
                      color: "var(--text-primary)",
                      fontFamily: "var(--font-sans), sans-serif",
                      fontWeight: 600,
                    }}
                  >
                    Delete this saved graph?
                  </h3>
                  <p
                    style={{
                      fontSize: 14,
                      lineHeight: 1.6,
                      color: "var(--text-secondary)",
                    }}
                  >
                    This hides <strong>{pendingDeleteGraph.metadata.title || pendingDeleteGraph.query}</strong> from history.
                    The record is soft-deleted, so it is not removed permanently from the database.
                  </p>
                </div>

                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    color: "var(--text-secondary)",
                    fontSize: 13,
                    cursor: "pointer",
                    userSelect: "none",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={neverShowDeleteConfirmationAgain}
                    onChange={(e) => setNeverShowDeleteConfirmationAgain(e.currentTarget.checked)}
                    style={{ accentColor: "var(--accent)" }}
                  />
                  Never show again
                </label>

                <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                  <button
                    onClick={cancelDeleteSavedGraph}
                    style={{
                      height: 34,
                      padding: "0 12px",
                      borderRadius: 6,
                      border: "1px solid var(--border)",
                      background: "none",
                      color: "var(--text-secondary)",
                      cursor: "pointer",
                      fontSize: 12,
                      fontFamily: "var(--font-sans), sans-serif",
                      fontWeight: 500,
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={confirmDeleteSavedGraph}
                    style={{
                      height: 34,
                      padding: "0 12px",
                      borderRadius: 6,
                      border: "1px solid color-mix(in srgb, var(--cat-rose) 55%, var(--border))",
                      background: "color-mix(in srgb, var(--cat-rose) 12%, transparent)",
                      color: "var(--cat-rose)",
                      cursor: "pointer",
                      fontSize: 12,
                      fontFamily: "var(--font-sans), sans-serif",
                      fontWeight: 600,
                    }}
                  >
                    Delete graph
                  </button>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>

        <AnimatePresence mode="wait">
          {!timelineData && !isSearching && !isRestoring ? (
            /* Landing state */
            <motion.div
              key="landing"
              className="landing-scroll-root"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, y: -20, scale: 0.98 }}
              transition={{ duration: 0.4 }}
              ref={setLandingScrollRef}
              style={{
                height: "100%",
                position: "relative",
                width: "100%",
                overflowY: "auto",
                overflowX: "hidden",
                scrollBehavior: "smooth",
              }}
            >
              <section className="landing-hero-shell">
                <div className="landing-hero-grid" aria-hidden="true" />

                <svg
                  className="landing-hero-graph"
                  viewBox="0 0 1440 820"
                  preserveAspectRatio="xMidYMid slice"
                  aria-hidden="true"
                >
                  {/* citation edges — left lineage */}
                  <path className="landing-hero-graph-edge" d="M70 250 C160 250,160 340,250 340" />
                  <path className="landing-hero-graph-edge" d="M60 430 C155 430,155 340,250 340" />
                  <path className="landing-hero-graph-edge" d="M60 430 C165 430,165 520,270 520" />
                  <path className="landing-hero-graph-edge" d="M110 600 C190 600,190 520,270 520" />
                  <path className="landing-hero-graph-edge" d="M250 340 C340 340,340 250,430 250" />
                  <path className="landing-hero-graph-edge" d="M250 340 C330 340,330 470,410 470" />
                  <path className="landing-hero-graph-edge" d="M270 520 C340 520,340 470,410 470" />
                  <path className="landing-hero-graph-edge" d="M430 250 C420 360,420 360,410 470" />
                  <path className="landing-hero-graph-edge is-accent" d="M410 470 C560 470,560 660,720 660" />
                  {/* citation edges — right lineage */}
                  <path className="landing-hero-graph-edge" d="M1370 250 C1280 250,1280 340,1190 340" />
                  <path className="landing-hero-graph-edge" d="M1380 430 C1285 430,1285 340,1190 340" />
                  <path className="landing-hero-graph-edge" d="M1380 430 C1275 430,1275 520,1170 520" />
                  <path className="landing-hero-graph-edge" d="M1330 600 C1250 600,1250 520,1170 520" />
                  <path className="landing-hero-graph-edge" d="M1190 340 C1100 340,1100 250,1010 250" />
                  <path className="landing-hero-graph-edge" d="M1190 340 C1110 340,1110 470,1030 470" />
                  <path className="landing-hero-graph-edge" d="M1170 520 C1100 520,1100 470,1030 470" />
                  <path className="landing-hero-graph-edge" d="M1010 250 C1020 360,1020 360,1030 470" />
                  <path className="landing-hero-graph-edge is-accent" d="M1030 470 C880 470,880 660,720 660" />

                  {/* paper cards */}
                  <rect className="landing-hero-graph-card" x="239" y="333" width="22" height="14" rx="2" />
                  <rect className="landing-hero-graph-card is-accent" x="399" y="463" width="22" height="14" rx="2" />
                  <rect className="landing-hero-graph-card" x="1179" y="333" width="22" height="14" rx="2" />
                  <rect className="landing-hero-graph-card is-accent" x="1019" y="463" width="22" height="14" rx="2" />

                  {/* nodes */}
                  <circle className="landing-hero-graph-node" cx="70" cy="250" r="3.5" />
                  <circle className="landing-hero-graph-node" cx="60" cy="430" r="3.5" />
                  <circle className="landing-hero-graph-node" cx="110" cy="600" r="3.5" />
                  <circle className="landing-hero-graph-node" cx="270" cy="520" r="3.5" />
                  <circle className="landing-hero-graph-node" cx="430" cy="250" r="3.5" />
                  <circle className="landing-hero-graph-node" cx="1370" cy="250" r="3.5" />
                  <circle className="landing-hero-graph-node" cx="1380" cy="430" r="3.5" />
                  <circle className="landing-hero-graph-node" cx="1330" cy="600" r="3.5" />
                  <circle className="landing-hero-graph-node" cx="1170" cy="520" r="3.5" />
                  <circle className="landing-hero-graph-node" cx="1010" cy="250" r="3.5" />

                  {/* field diagrams — chemistry, ai, physics, biology */}
                  {/* benzene ring */}
                  <g transform="translate(350 215)">
                    <polygon className="landing-hero-graph-glyph" points="0,-24 20.8,-12 20.8,12 0,24 -20.8,12 -20.8,-12" />
                    <circle className="landing-hero-graph-glyph" cx="0" cy="0" r="12.5" />
                  </g>
                  {/* neural network */}
                  <g transform="translate(1200 655)">
                    <line className="landing-hero-graph-glyph" x1="-24" y1="-12" x2="0" y2="-18" />
                    <line className="landing-hero-graph-glyph" x1="-24" y1="-12" x2="0" y2="0" />
                    <line className="landing-hero-graph-glyph" x1="-24" y1="-12" x2="0" y2="18" />
                    <line className="landing-hero-graph-glyph" x1="-24" y1="12" x2="0" y2="-18" />
                    <line className="landing-hero-graph-glyph" x1="-24" y1="12" x2="0" y2="0" />
                    <line className="landing-hero-graph-glyph" x1="-24" y1="12" x2="0" y2="18" />
                    <line className="landing-hero-graph-glyph" x1="0" y1="-18" x2="24" y2="-12" />
                    <line className="landing-hero-graph-glyph" x1="0" y1="-18" x2="24" y2="12" />
                    <line className="landing-hero-graph-glyph" x1="0" y1="0" x2="24" y2="-12" />
                    <line className="landing-hero-graph-glyph" x1="0" y1="0" x2="24" y2="12" />
                    <line className="landing-hero-graph-glyph" x1="0" y1="18" x2="24" y2="-12" />
                    <line className="landing-hero-graph-glyph" x1="0" y1="18" x2="24" y2="12" />
                    <circle className="landing-hero-graph-glyph-dot" cx="-24" cy="-12" r="2.6" />
                    <circle className="landing-hero-graph-glyph-dot" cx="-24" cy="12" r="2.6" />
                    <circle className="landing-hero-graph-glyph-dot" cx="0" cy="-18" r="2.6" />
                    <circle className="landing-hero-graph-glyph-dot" cx="0" cy="0" r="2.6" />
                    <circle className="landing-hero-graph-glyph-dot" cx="0" cy="18" r="2.6" />
                    <circle className="landing-hero-graph-glyph-dot is-accent" cx="24" cy="-12" r="2.6" />
                    <circle className="landing-hero-graph-glyph-dot" cx="24" cy="12" r="2.6" />
                  </g>
                  {/* atom */}
                  <g transform="translate(300 690)">
                    <ellipse className="landing-hero-graph-glyph" rx="30" ry="11" />
                    <ellipse className="landing-hero-graph-glyph" rx="30" ry="11" transform="rotate(60)" />
                    <ellipse className="landing-hero-graph-glyph" rx="30" ry="11" transform="rotate(120)" />
                    <circle className="landing-hero-graph-glyph-dot is-accent" cx="0" cy="0" r="3.2" />
                  </g>
                  {/* dna double helix */}
                  <g transform="translate(1220 205)">
                    <path className="landing-hero-graph-glyph" d="M -8 -42 C 8 -34 8 -22 -8 -14 C -24 -6 -24 6 -8 14 C 8 22 8 34 -8 42" />
                    <path className="landing-hero-graph-glyph" d="M 8 -42 C -8 -34 -8 -22 8 -14 C 24 -6 24 6 8 14 C -8 22 -8 34 8 42" />
                    <line className="landing-hero-graph-glyph" x1="-8" y1="-42" x2="8" y2="-42" />
                    <line className="landing-hero-graph-glyph" x1="-8" y1="-14" x2="8" y2="-14" />
                    <line className="landing-hero-graph-glyph" x1="-8" y1="14" x2="8" y2="14" />
                    <line className="landing-hero-graph-glyph" x1="-8" y1="42" x2="8" y2="42" />
                  </g>

                  {/* year ticks — old on the left, recent on the right */}
                  <text className="landing-hero-graph-year" x="70" y="230" textAnchor="middle">1949</text>
                  <text className="landing-hero-graph-year" x="110" y="626" textAnchor="middle">1974</text>
                  <text className="landing-hero-graph-year" x="1370" y="230" textAnchor="middle">2013</text>
                  <text className="landing-hero-graph-year" x="1330" y="626" textAnchor="middle">2024</text>

                  {/* field-note remarks in the margins */}
                  <text className="landing-hero-graph-remark is-accent" x="410" y="452" textAnchor="middle">seed</text>
                  <text className="landing-hero-graph-remark" x="214" y="566" textAnchor="middle">cited 1,204</text>
                  <text className="landing-hero-graph-remark is-accent" x="1030" y="452" textAnchor="middle">→ attention</text>
                  <text className="landing-hero-graph-remark" x="1214" y="566" textAnchor="middle">why here?</text>

                  {/* equations — physics · ai · math */}
                  <text className="landing-hero-graph-eq" x="150" y="130" textAnchor="middle" transform="rotate(-2 150 130)">
                    E = mc<tspan dy="-9" fontSize="17">2</tspan>
                  </text>
                  <text className="landing-hero-graph-eq is-accent" x="1300" y="130" textAnchor="middle" transform="rotate(2 1300 130)">
                    θ ← θ − η∇L(θ)
                  </text>
                  <text className="landing-hero-graph-eq" x="1150" y="740" textAnchor="middle" transform="rotate(1 1150 740)">
                    e<tspan dy="-9" fontSize="17">iπ</tspan>
                    <tspan dy="9" fontSize="26"> + 1 = 0</tspan>
                  </text>

                  {/* pinned field notes */}
                  <g transform="translate(300 110)">
                    <rect className="landing-hero-graph-note" x="0" y="0" width="78" height="50" rx="3" />
                    <rect className="landing-hero-graph-note-bar is-amber" x="0" y="0" width="3" height="50" rx="1.5" />
                    <text className="landing-hero-graph-note-tag" x="12" y="17">QUESTION</text>
                    <rect className="landing-hero-graph-note-line" x="12" y="26" width="46" height="3" rx="1.5" />
                    <rect className="landing-hero-graph-note-line" x="12" y="35" width="56" height="3" rx="1.5" />
                  </g>
                  <g transform="translate(1010 110)">
                    <rect className="landing-hero-graph-note" x="0" y="0" width="100" height="50" rx="3" />
                    <rect className="landing-hero-graph-note-bar is-green" x="0" y="0" width="3" height="50" rx="1.5" />
                    <text className="landing-hero-graph-note-tag" x="12" y="17">FIELD NOTE</text>
                    <rect className="landing-hero-graph-note-line" x="12" y="26" width="54" height="3" rx="1.5" />
                    <rect className="landing-hero-graph-note-line" x="12" y="35" width="42" height="3" rx="1.5" />
                  </g>
                  <g transform="translate(430 690)">
                    <rect className="landing-hero-graph-note" x="0" y="0" width="78" height="50" rx="3" />
                    <rect className="landing-hero-graph-note-bar" x="0" y="0" width="3" height="50" rx="1.5" />
                    <text className="landing-hero-graph-note-tag" x="12" y="17">INSIGHT</text>
                    <rect className="landing-hero-graph-note-line" x="12" y="26" width="52" height="3" rx="1.5" />
                    <rect className="landing-hero-graph-note-line" x="12" y="35" width="40" height="3" rx="1.5" />
                  </g>
                  <g transform="translate(960 700)">
                    <rect className="landing-hero-graph-note" x="0" y="0" width="78" height="50" rx="3" />
                    <rect className="landing-hero-graph-note-bar is-rose" x="0" y="0" width="3" height="50" rx="1.5" />
                    <text className="landing-hero-graph-note-tag" x="12" y="17">TODO</text>
                    <rect className="landing-hero-graph-note-line" x="12" y="26" width="48" height="3" rx="1.5" />
                    <rect className="landing-hero-graph-note-line" x="12" y="35" width="58" height="3" rx="1.5" />
                  </g>
                </svg>

                <div className="landing-hero-content">
                  <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      duration: 0.7,
                      ease: [0.16, 1, 0.3, 1],
                    }}
                    className="landing-hero-copy"
                  >
                    <motion.p
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.1, duration: 0.5 }}
                      className="landing-eyebrow"
                    >
                      <span aria-hidden="true" />
                      Research lineage explorer
                      <span aria-hidden="true" />
                    </motion.p>
                    <h1 className="landing-hero-title">
                      Follow the work
                      <br />
                      <em>beneath the work.</em>
                    </h1>
                    <p className="landing-hero-description">
                      Start with a concept or paper. Sediment maps the ideas,
                      citations, and breakthroughs that made it possible.
                    </p>
                  </motion.div>

                  <div
                    ref={landingSearchRef}
                    className="landing-search-zone"
                  >
                    <SearchInput
                      onSearch={handleSearch}
                      isSearching={isSearching || isExpanding || isClarifying}
                      traceMode={traceMode}
                      onTraceModeChange={setTraceMode}
                    />
                  </div>

                  {!!searchError && (
                    <motion.div
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      style={{
                        marginTop: "1rem",
                        padding: "0.75rem 0.875rem",
                        borderRadius: "0.75rem",
                        border: "0.0625rem solid var(--border)",
                        background: "var(--bg-secondary)",
                        color: "var(--text-secondary)",
                        maxWidth: "32.5rem",
                        width: "100%",
                        textAlign: "left",
                        fontSize: "0.8125rem",
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
                        marginTop: "1rem",
                        padding: "0.875rem",
                        borderRadius: "1rem",
                        border: "0.0625rem solid var(--border)",
                        background: "var(--bg-secondary)",
                        maxWidth: "32.5rem",
                        width: "100%",
                        display: "flex",
                        flexDirection: "column",
                        gap: "0.625rem",
                      }}
                    >
                      <p
                        style={{
                          fontSize: "0.75rem",
                          color: "var(--text-tertiary)",
                          fontFamily: "var(--font-mono), monospace",
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
                            padding: "0.75rem 0.875rem",
                            borderRadius: "0.75rem",
                            border: "0.0625rem solid var(--border)",
                            background: "var(--bg-primary)",
                            cursor: "pointer",
                            color: "var(--text-primary)",
                          }}
                        >
                          <div
                            style={{ fontSize: "0.8125rem", fontWeight: 600 }}
                          >
                            {candidate.title}
                          </div>
                          <div
                            style={{
                              fontSize: "0.6875rem",
                              color: "var(--text-tertiary)",
                              marginTop: "0.25rem",
                            }}
                          >
                            {candidate.year ?? "Unknown year"}
                          </div>
                        </button>
                      ))}
                    </motion.div>
                  )}
                </div>

                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.6, duration: 1 }}
                  className="hide-mobile landing-hero-footer"
                >
                </motion.div>
              </section>

              <LandingDemos
                containerRef={landingScrollRef}
                compact={compact}
                onScrollToSearch={handleScrollToSearch}
              />
            </motion.div>
          ) : isSearching || isRestoring || isClarifying ? (
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
                gap: "1.25rem",
              }}
            >
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3, ease: "easeOut" }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--accent)",
                }}
              >
                <LoadingLogoMark
                  width="64"
                  height="64"
                  reducedMotion={reduceMotion ?? false}
                />
              </motion.div>
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.3 }}
                style={{
                  fontSize: "0.8125rem",
                  color: "var(--text-tertiary)",
                  fontFamily: "var(--font-mono), monospace",
                  letterSpacing: "0.02em",
                }}
              >
                {isRestoring
                  ? "restoring your last graph"
                  : isClarifying
                    ? "checking your query..."
                    : traceMode === "deep"
                      ? `researching a deep trace for "${searchedQuery}"`
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
              style={{ height: "100%", padding: "0.5rem" }}
            >
              <TimelineCanvas
                data={timelineData!}
                onExpandNode={handleExpandNode}
                onGraphAction={handleTimelineGraphAction}
                onLineageChanges={handleTimelineLineageChanges}
                onNoteChanges={handleTimelineNoteChanges}
                onNodeColorChanges={handleTimelineNodeColorChanges}
                lockedNodeOpenalexId={selectedSeedOpenalexId}
                isExpanding={isExpanding}
                onUsageChanged={refreshCredits}
                hoverPreviewEnabled={hoverPreviewEnabled}
                onToggleHoverPreview={onToggleHoverPreview}
                globalChatOpen={globalChatOpen}
                onGlobalChatOpenChange={setGlobalChatOpen}
                closePaperPanelSignal={closePaperPanelSignal}
                graphId={graphId}
                userId={userId}
                saveState={saveState}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
