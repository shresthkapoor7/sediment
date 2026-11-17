"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useState, useCallback, useEffect, useMemo, useRef, type CSSProperties } from "react";
import { m, AnimatePresence, useReducedMotion } from "framer-motion";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LoadingLogoMark, LogoMark } from "@/components/LogoMark";
import { AppHeader } from "@/components/AppHeader";
import { AsciiBackdrop } from "@/components/AsciiBackdrop";
import { LandingBrain } from "@/components/LandingBrain";
import { GitHubMark } from "@/components/GitHubMark";
import { FeedsView } from "@/components/feeds/FeedsView";
import { whenIdle } from "@/lib/when-idle";

// Graph view + clarification modal are never shown on the landing page — load their
// chunks (which pull in the chat panel, paper reader, react-markdown and KaTeX) on demand.
const TimelineCanvas = dynamic(
  () => import("@/components/TimelineCanvas").then((mod) => mod.TimelineCanvas),
  { ssr: false },
);
import {
  APIError,
  APP_VERSION,
  createSavedGraph,
  fetchSavedGraph,
  fetchUsage,
  getOrCreateAnonymousUserId,
  LAST_GRAPH_ID_KEY,
  registerAnonymousUser,
  shareGraph,
  updateSavedGraph,
} from "@/lib/api";
import { useHoverPreviewToggle } from "@/lib/hover-preview";
import { useLandingViewport } from "@/lib/use-landing-viewport";
import { upgradeLegacyTimelineNoteLayout } from "@/lib/note-layout";
import { applyTimelineGraphAction, applyTimelineLineageChanges, applyTimelineNodeColorChanges, applyTimelineNoteChanges } from "@/lib/timeline-actions";
import { createEmptyTimeline } from "@/lib/timeline-builder";
import {
  CanvasDetailsChange,
  LineageChange,
  TimelineData,
  TimelineGraphAction,
  TimelineNodeColorChange,
  TimelineNoteChange,
} from "@/lib/types";
import { exportObsidianZip } from "@/lib/export";
import { describeGraphAction, useCanvasHistory, type HistoryMeta } from "@/lib/canvas-history";

// The agent often changes the board several times in one reply; those count as one step.
const AGENT_EDIT: HistoryMeta = { label: "Agent edit", key: "agent", windowMs: 4000 };

const GITHUB_REPO_URL = "https://github.com/shresthkapoor7/sediment";

export default function Home() {
  const reduceMotion = useReducedMotion();
  const [timelineData, setTimelineData] = useState<TimelineData | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isRestoring, setIsRestoring] = useState(true);
  const [searchedQuery, setSearchedQuery] = useState("");
  const [searchError, setSearchError] = useState("");
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
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [shareState, setShareState] = useState<
    "idle" | "sharing" | "copied" | "error"
  >("idle");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [globalChatOpen, setGlobalChatOpen] = useState(false);
  const [agentKickoff, setAgentKickoff] = useState<{ text: string; nonce: number } | null>(null);
  const clearAgentKickoff = useCallback(() => setAgentKickoff(null), []);
  const [closePaperPanelSignal, setClosePaperPanelSignal] = useState(0);
  const [credits, setCredits] = useState<number>(10);
  const shareStateTimeoutRef = useRef<number | null>(null);
  const saveTimeoutRef = useRef<number | null>(null);
  const saveStateTimeoutRef = useRef<number | null>(null);
  const graphTitleInputRef = useRef<HTMLInputElement | null>(null);
  const graphTitleRef = useRef("");
  const [graphDescription, setGraphDescription] = useState("");
  const graphDescriptionRef = useRef("");
  // Who last named and described the canvas. The agent may fill in a default, never overwrite the researcher.
  const [titleSetBy, setTitleSetBy] = useState<"user" | "agent" | null>(null);
  const [descriptionSetBy, setDescriptionSetBy] = useState<"user" | "agent" | null>(null);
  const titleSetByRef = useRef<"user" | "agent" | null>(null);
  const descriptionSetByRef = useRef<"user" | "agent" | null>(null);
  const setDetailAuthors = useCallback((title: "user" | "agent" | null, description: "user" | "agent" | null) => {
    titleSetByRef.current = title;
    descriptionSetByRef.current = description;
    setTitleSetBy(title);
    setDescriptionSetBy(description);
  }, []);
  const graphTitleEditCanceledRef = useRef(false);
  const isSavingGraphTitleRef = useRef(false);
  // Expose the landing scroll container to AppHeader as state (via a stable
  // callback ref) so the header can attach its own scroll listener the moment
  // the container mounts — keeping scroll-driven compaction out of Home's renders.
  const [landingScrollEl, setLandingScrollEl] = useState<HTMLDivElement | null>(null);
  const setLandingScrollRef = useCallback((node: HTMLDivElement | null) => {
    setLandingScrollEl(node);
  }, []);
  const { mobile } = useLandingViewport();

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
      description: graphDescriptionRef.current,
      titleSetBy: titleSetByRef.current,
      descriptionSetBy: descriptionSetByRef.current,
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
    return fetchUsage()
      .then((data) => setCredits(data.segments))
      .catch(() => undefined);
  }, []);

  // The feed waits for the top of the page: credits first (they sit in the top bar), then the
  // browser going idle. A slow usage call never holds the feed back for more than a few seconds.
  const [feedReady, setFeedReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let started = false;
    let cancelIdle = () => {};
    const start = () => {
      if (started) return;
      started = true;
      cancelIdle = whenIdle(() => { if (!cancelled) setFeedReady(true); });
    };
    const fallback = window.setTimeout(start, 3000);
    void refreshCredits().then(() => { window.clearTimeout(fallback); start(); });
    return () => { cancelled = true; window.clearTimeout(fallback); cancelIdle(); };
  }, [refreshCredits]);

  useEffect(() => {
    const nextUserId = getOrCreateAnonymousUserId();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- The anonymous id only exists in the browser.
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
        graphDescriptionRef.current = graph.metadata.description ?? "";
        setGraphDescription(graph.metadata.description ?? "");
        setDetailAuthors(graph.metadata.titleSetBy ?? null, graph.metadata.descriptionSetBy ?? null);
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
    const previousTitleSetBy = titleSetByRef.current;
    titleSetByRef.current = "user";
    setTitleSetBy("user");
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
        titleSetByRef.current = previousTitleSetBy;
        setTitleSetBy(previousTitleSetBy);
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

  const saveGraphDescription = useCallback((next: string) => {
    if (!graphId || !userId || !timelineData) return;
    const previous = graphDescriptionRef.current;
    if (next === previous) return;
    const previousSetBy = descriptionSetByRef.current;
    graphDescriptionRef.current = next;
    setGraphDescription(next);
    descriptionSetByRef.current = "user";
    setDescriptionSetBy("user");
    setSaveState("saving");
    void updateSavedGraph(graphId, {
      userId,
      metadata: buildMetadata(searchedQuery, timelineData, graphTitleRef.current || searchedQuery),
    })
      .then(() => {
        setSaveState("saved");
        saveStateTimeoutRef.current = window.setTimeout(() => setSaveState("idle"), 1800);
      })
      .catch(() => {
        graphDescriptionRef.current = previous;
        setGraphDescription(previous);
        descriptionSetByRef.current = previousSetBy;
        setDescriptionSetBy(previousSetBy);
        setSaveState("error");
      });
  }, [buildMetadata, graphId, searchedQuery, timelineData, userId]);


  // A new canvas starts empty. The query becomes the first message to the agent, which decides with
  // the researcher what goes on the board.
  const startCanvas = useCallback(
    async (query: string) => {
      const text = query.trim();
      if (!text || !userId || isSearching) return;
      if (saveTimeoutRef.current) window.clearTimeout(saveTimeoutRef.current);
      if (saveStateTimeoutRef.current) window.clearTimeout(saveStateTimeoutRef.current);
      // A pasted link or ID is not a name; the researcher can rename the canvas from the top bar.
      const looksLikeLink = /^(https?:\/\/|www\.|doi:|arxiv:|10\.\d{4,}\/)/i.test(text) || /^W\d{4,}$/i.test(text);
      const title = looksLikeLink ? "Untitled canvas" : text.length > 60 ? `${text.slice(0, 57).trimEnd()}…` : text;
      const emptyData = createEmptyTimeline();
      setIsSearching(true);
      setSearchError("");
      setSearchedQuery(title);
      try {
        const savedGraph = await createSavedGraph({
          userId,
          query: title,
          data: emptyData,
          seedPaperId: null,
          metadata: buildMetadata(title, emptyData),
        });
        setTimelineData(emptyData);
        setGraphId(savedGraph.id);
        setGraphOwnerId(savedGraph.userId);
        setGraphTitle(savedGraph.metadata.title || title);
        graphDescriptionRef.current = "";
        setGraphDescription("");
        setDetailAuthors(null, null);
        setGraphTitleDraft("");
        setIsEditingGraphTitle(false);
        setSelectedSeedOpenalexId(null);
        setSaveState("idle");
        persistLastGraphId(savedGraph.id);
        setAgentKickoff({ text, nonce: Date.now() });
        setGlobalChatOpen(true);
      } catch (error) {
        setSearchedQuery("");
        setSearchError(
          error instanceof APIError && error.status === 429
            ? error.message
            : "A new canvas could not be opened. Try again in a moment.",
        );
      } finally {
        setIsSearching(false);
      }
    },
    [buildMetadata, isSearching, persistLastGraphId, userId],
  );

  const handleReset = useCallback(() => {
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
    graphDescriptionRef.current = "";
    setGraphDescription("");
    setDetailAuthors(null, null);
    setGraphTitleDraft("");
    setIsEditingGraphTitle(false);
    setSelectedSeedOpenalexId(null);
    setSaveState("idle");
    setSearchedQuery("");
    setSearchError("");
    setGlobalChatOpen(false);
    setAgentKickoff(null);
    setClosePaperPanelSignal((value) => value + 1);
    persistLastGraphId(null);
  }, [persistLastGraphId]);

  const handleToggleGlobalChat = useCallback(() => {
    setClosePaperPanelSignal((value) => value + 1);
    setGlobalChatOpen((open) => !open);
  }, []);

  // Canvas edits are applied to the newest canvas, never to the copy a handler happened to capture.
  // The agent holds on to these handlers for the length of a reply, during which it and the user may
  // both change the board; working from a captured copy would silently undo the earlier change.
  const timelineDataRef = useRef<TimelineData | null>(null);
  useEffect(() => {
    timelineDataRef.current = timelineData;
  }, [timelineData]);
  const { undoItems, redoItems, record: recordHistory, undo: undoHistory, redo: redoHistory, clear: clearHistory } = useCanvasHistory();

  // Every change goes through here. Passing `history` makes it a step the researcher can undo.
  const commitTimeline = useCallback(
    (update: (current: TimelineData) => TimelineData, history?: HistoryMeta | null) => {
      const current = timelineDataRef.current;
      if (!current) return;
      const next = update(current);
      if (next === current) return;
      if (history) recordHistory(current, history);
      timelineDataRef.current = next;
      setTimelineData(next);
      scheduleGraphUpdate(next, searchedQuery);
    },
    [recordHistory, scheduleGraphUpdate, searchedQuery],
  );

  // Each canvas has its own history.
  useEffect(() => {
     
    clearHistory();
  }, [graphId, clearHistory]);

  const showHistoryResult = useCallback((next: TimelineData | null) => {
    if (!next) return;
    timelineDataRef.current = next;
    setTimelineData(next);
    scheduleGraphUpdate(next, searchedQuery);
  }, [scheduleGraphUpdate, searchedQuery]);

  const handleUndo = useCallback((steps = 1) => {
    const current = timelineDataRef.current;
    if (current) showHistoryResult(undoHistory(current, steps));
  }, [showHistoryResult, undoHistory]);

  const handleRedo = useCallback((steps = 1) => {
    const current = timelineDataRef.current;
    if (current) showHistoryResult(redoHistory(current, steps));
  }, [redoHistory, showHistoryResult]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key !== "z" && key !== "y") return;
      const target = event.target as HTMLElement | null;
      // Inside a text field, undo means undoing the typing.
      if (target && (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName))) return;
      event.preventDefault();
      if (key === "y" || event.shiftKey) handleRedo();
      else handleUndo();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleRedo, handleUndo]);

  // The agent named or described the canvas. Its instructions keep it off anything the researcher set unless
  // they ask, which is also why this cannot block it: "rename this canvas" has to work.
  const handleAgentCanvasDetails = useCallback((details: CanvasDetailsChange) => {
    const current = timelineDataRef.current;
    if (!graphId || !userId || !current) return;
    const title = details.title?.trim();
    const description = details.description?.trim();
    let changed = false;
    if (title && title !== graphTitleRef.current) {
      graphTitleRef.current = title;
      setGraphTitle(title);
      titleSetByRef.current = "agent";
      setTitleSetBy("agent");
      changed = true;
    }
    if (description && description !== graphDescriptionRef.current) {
      graphDescriptionRef.current = description;
      setGraphDescription(description);
      descriptionSetByRef.current = "agent";
      setDescriptionSetBy("agent");
      changed = true;
    }
    if (!changed) return;
    setSaveState("saving");
    void updateSavedGraph(graphId, {
      userId,
      metadata: buildMetadata(searchedQuery, current, graphTitleRef.current || searchedQuery),
    })
      .then(() => {
        setSaveState("saved");
        saveStateTimeoutRef.current = window.setTimeout(() => setSaveState("idle"), 1800);
      })
      .catch(() => setSaveState("error"));
  }, [buildMetadata, graphId, searchedQuery, userId]);

  const canvasDetails = useMemo(() => ({
    title: graphTitle || searchedQuery,
    description: graphDescription,
    titleSetBy,
    descriptionSetBy,
  }), [descriptionSetBy, graphDescription, graphTitle, searchedQuery, titleSetBy]);

  const handleTimelineGraphAction = useCallback(
    (action: TimelineGraphAction) => commitTimeline((current) => applyTimelineGraphAction(current, action, {
      lockedOpenalexIds: selectedSeedOpenalexId ? [selectedSeedOpenalexId] : [],
    }), timelineDataRef.current ? describeGraphAction(timelineDataRef.current, action) : null),
    [commitTimeline, selectedSeedOpenalexId],
  );

  const handleTimelineLineageChanges = useCallback(
    (changes: LineageChange[]) => {
      if (changes.length === 0) return;
      commitTimeline((current) => applyTimelineLineageChanges(current, changes, {
        lockedOpenalexIds: selectedSeedOpenalexId ? [selectedSeedOpenalexId] : [],
      }), AGENT_EDIT);
    },
    [commitTimeline, selectedSeedOpenalexId],
  );

  const handleTimelineNoteChanges = useCallback(
    (changes: TimelineNoteChange[]) => {
      if (changes.length === 0) return;
      commitTimeline((current) => applyTimelineNoteChanges(current, changes), AGENT_EDIT);
    },
    [commitTimeline],
  );

  const handleTimelineNodeColorChanges = useCallback(
    (changes: TimelineNodeColorChange[]) => {
      if (changes.length === 0) return;
      commitTimeline((current) => applyTimelineNodeColorChanges(current, changes), AGENT_EDIT);
    },
    [commitTimeline],
  );

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

  // The home screen shows the header inside its scroll container, so it scrolls away with the page.
  const showLandingView = !timelineData && !isSearching && !isRestoring;
  const appHeader = (
    <AppHeader
      timelineData={timelineData}
      mobile={mobile}
      searchedQuery={searchedQuery}
      graphTitle={graphTitle}
      graphDescription={graphDescription}
      onSaveGraphDescription={canEditGraphTitle ? saveGraphDescription : undefined}
      graphTitleDraft={graphTitleDraft}
      isEditingGraphTitle={isEditingGraphTitle}
      canEditGraphTitle={canEditGraphTitle}
      graphTitleInputRef={graphTitleInputRef}
      mobileMenuOpen={mobileMenuOpen}
      globalChatOpen={globalChatOpen}
      credits={credits}
      shareState={shareState}
      landingScrollEl={landingScrollEl}
      setMobileMenuOpen={setMobileMenuOpen}
      setGraphTitleDraft={setGraphTitleDraft}
      handleReset={handleReset}
      handleExport={handleExport}
      handleShare={handleShare}
      handleToggleGlobalChat={handleToggleGlobalChat}
      startGraphTitleEdit={startGraphTitleEdit}
      saveGraphTitle={saveGraphTitle}
      cancelGraphTitleEdit={cancelGraphTitleEdit}
    />
  );

  return (
    <div
      className={`app-shell${timelineData ? " canvas-shell" : " landing-shell"}${isSearching || isRestoring ? " graph-loading-shell" : ""}`}
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Top bar: the home screen renders it inside the scrolling page instead, so it scrolls away */}
      {!showLandingView && appHeader}

      {/* Main content */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        {/* Fixed behind the scrolling home page, so the feed scrolls over the ridge */}
        {!timelineData && !isSearching && !isRestoring && <AsciiBackdrop />}

        <AnimatePresence mode="wait">
          {!timelineData && !isSearching && !isRestoring ? (
            /* Landing state */
            <m.div
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
              {showLandingView && appHeader}
              <section className="landing-hero-shell">
                <div className="landing-hero-content">
                  <m.div
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      duration: 0.7,
                      ease: [0.16, 1, 0.3, 1],
                    }}
                    className="landing-hero-copy"
                  >
                    <h1 className="landing-hero-title">
                      Canvas for modern{" "}
                      <span className="landing-title-tail">
                        research <LandingBrain />.
                      </span>
                    </h1>
                    <p className="landing-hero-description">
                      Sediment is an{" "}
                      <a className="landing-brand" href={GITHUB_REPO_URL} target="_blank" rel="noreferrer">
                        <GitHubMark className="landing-brand-icon" />
                        open-source
                      </a>
                      , AI-powered research workspace. Explore papers, trace citation lineage, and synthesize
                      breakthroughs on an infinite canvas, with data from{" "}
                      <a className="landing-brand" href="https://openalex.org" target="_blank" rel="noreferrer">
                        <span
                          className="landing-brand-icon landing-brand-mask"
                          style={{ "--icon": "url(/openalex.svg)" } as CSSProperties}
                        />
                        OpenAlex
                      </a>
                      .
                    </p>
                  </m.div>

                  {!!searchError && (
                    <m.div
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
                    </m.div>
                  )}


                </div>

                <m.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.6, duration: 1 }}
                  className="hide-mobile landing-hero-footer"
                >
                </m.div>
              </section>

              <section className="landing-feed" aria-label="Paper feed">
                <FeedsView embedded ready={feedReady} onSearch={startCanvas} searching={isSearching} />
              </section>
            </m.div>
          ) : isSearching || isRestoring ? (
            /* Loading state */
            <m.div
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
              <m.div
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
              </m.div>
              <m.p
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
                {isRestoring ? "opening your canvas" : "setting up a new canvas"}
              </m.p>
            </m.div>
          ) : (
            /* Timeline state */
            <m.div
              key="timeline"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5 }}
              style={{ height: "100%" }}
            >
              <TimelineCanvas
                data={timelineData!}
                onGraphAction={handleTimelineGraphAction}
                onLineageChanges={handleTimelineLineageChanges}
                onNoteChanges={handleTimelineNoteChanges}
                onNodeColorChanges={handleTimelineNodeColorChanges}
                canvasDetails={canvasDetails}
                onCanvasDetailsChange={handleAgentCanvasDetails}
                lockedNodeOpenalexId={selectedSeedOpenalexId}
                onUsageChanged={refreshCredits}
                hoverPreviewEnabled={hoverPreviewEnabled}
                onToggleHoverPreview={onToggleHoverPreview}
                globalChatOpen={globalChatOpen}
                onGlobalChatOpenChange={setGlobalChatOpen}
                agentKickoff={agentKickoff}
                onAgentKickoffSent={clearAgentKickoff}
                closePaperPanelSignal={closePaperPanelSignal}
                graphId={graphId}
                userId={userId}
                saveState={saveState}
                history={{ undoItems, redoItems, onUndo: handleUndo, onRedo: handleRedo }}
              />
            </m.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
