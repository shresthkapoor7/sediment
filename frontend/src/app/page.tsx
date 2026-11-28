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
import type { FeedPaper } from "@/lib/feeds-api";
import { whenIdle } from "@/lib/when-idle";

// The graph view is never shown on the landing page — load its
// chunks (which pull in the chat panel, paper reader, react-markdown and KaTeX) on demand.
const TimelineCanvas = dynamic(
  () => import("@/components/TimelineCanvas").then((mod) => mod.TimelineCanvas),
  { ssr: false },
);
import {
  APIError,
  APP_VERSION,
  createSavedGraph,
  postCanvasOps,
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
import { LandingDemo } from "@/components/LandingDemo";
import { upgradeLegacyTimelineNoteLayout } from "@/lib/note-layout";
import { applyTimelineGraphAction } from "@/lib/timeline-actions";
import { useAuth } from "@/components/AuthProvider";
import { applyCanvasOp, applyCanvasOps, MAX_OPS_PER_COMMIT, withPaperRefs, type CanvasOp, type CanvasOpSource } from "@/lib/canvas-ops";
import { createEmptyTimeline } from "@/lib/timeline-builder";
import {
  CanvasDetailsChange,
  GraphPaper,
  LineageChange,
  TimelineNote,
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
  const { user: account } = useAuth();
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
  const timelineDataRef = useRef<TimelineData | null>(null);
  const graphVersionRef = useRef(0);
  // The queue belongs to one canvas (opsGraphRef); opening another canvas starts a new queue, and a flush that
  // finishes after that leaves the new canvas alone. Entries keep their batch id once sent, so a resend after a
  // failed request is recognised by the server and not applied twice.
  const pendingOpsRef = useRef<{ op: CanvasOp; via: CanvasOpSource; batchId?: string }[]>([]);
  const opsGraphRef = useRef<string | null>(null);
  const flushRef = useRef<{ graphId: string; promise: Promise<void> } | null>(null);
  const saveStateTimeoutRef = useRef<number | null>(null);
  const graphTitleInputRef = useRef<HTMLInputElement | null>(null);
  const graphTitleRef = useRef("");
  const [graphDescription, setGraphDescription] = useState("");
  const graphDescriptionRef = useRef("");
  // The canvas the latest description save was made for.
  const savingForGraphRef = useRef<string | null>(null);
  // Each description save gets a number; only the newest save may update the screen when it finishes.
  const descriptionSaveRef = useRef(0);
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

  // The home page shows the feed's start bar above the demo; the feed renders it into this slot.
  const [startBarSlot, setStartBarSlot] = useState<HTMLDivElement | null>(null);
  const creditsRequestRef = useRef(0);
  const refreshCredits = useCallback(() => {
    const request = ++creditsRequestRef.current;
    return fetchUsage()
      .then((data) => {
        if (request === creditsRequestRef.current) setCredits(data.segments);
      })
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
        graphVersionRef.current = graph.version ?? 0;
        pendingOpsRef.current = [];
        opsGraphRef.current = graph.id;
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

  // Canvas edits are sent as operations (see lib/canvas-ops): queued as they happen, flushed shortly after the
  // last one to the ops route, which applies them on the server and logs who made them. The screen already shows
  // the change; if someone else edited the canvas in between, the server's result is adopted and anything still
  // queued is re-applied on top of it.

  const flushOnce = useCallback((forGraphId: string): Promise<void> => {
    // Concurrent callers share the running flush, so none of them reports "saved" before the ops are stored.
    if (flushRef.current?.graphId === forGraphId) return flushRef.current.promise;
    const run = async () => {
      while (opsGraphRef.current === forGraphId && pendingOpsRef.current.length) {
        const queue = pendingOpsRef.current;
        let batch: typeof queue;
        if (queue[0].batchId) {
          // A batch that failed before: resend exactly it, under the same id.
          const id = queue[0].batchId;
          const end = queue.findIndex((entry) => entry.batchId !== id);
          batch = queue.slice(0, end < 0 ? queue.length : end);
        } else {
          // One commit per source, in order, so the log says whether the researcher or the agent made each change.
          const via = queue[0].via;
          const end = queue.findIndex((entry) => entry.via !== via || !!entry.batchId);
          batch = queue.slice(0, Math.min(end < 0 ? queue.length : end, MAX_OPS_PER_COMMIT));
          const id = crypto.randomUUID();
          for (const entry of batch) entry.batchId = id;
        }
        const result = await postCanvasOps(forGraphId, batch.map((entry) => entry.op), batch[0].via, batch[0].batchId!);
        if (opsGraphRef.current !== forGraphId) return; // another canvas is open now
        pendingOpsRef.current = pendingOpsRef.current.slice(batch.length);
        const expected = graphVersionRef.current + (result.changed ? 1 : 0);
        graphVersionRef.current = result.version;
        // Someone else changed the canvas (also when our ops turned out to be no-ops against their state):
        // adopt the server's canvas and re-apply what is still queued.
        if (result.version !== expected) {
          const rebased = applyCanvasOps(result.data, pendingOpsRef.current.map((entry) => entry.op));
          timelineDataRef.current = rebased;
          setTimelineData(rebased);
        }
      }
    };
    const promise = run().finally(() => {
      if (flushRef.current?.promise === promise) flushRef.current = null;
    });
    flushRef.current = { graphId: forGraphId, promise };
    return promise;
  }, []);

  const flushCanvasOps = useCallback(async (forGraphId: string): Promise<void> => {
    // Ops queued while a shared flush was finishing are sent too before the caller goes on.
    do await flushOnce(forGraphId);
    while (opsGraphRef.current === forGraphId && pendingOpsRef.current.length);
  }, [flushOnce]);

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
        void flushCanvasOps(graphId)
          // The canvas data went as operations; the title, query and counts still go as one small update.
          .then(() => updateSavedGraph(graphId, {
            userId,
            query: nextQuery,
            seedPaperId: selectedSeedOpenalexId ?? nextData.nodes[nextData.rootId]?.paper.openalexId ?? null,
            metadata: buildMetadata(nextQuery, nextData, graphTitleRef.current || nextQuery),
          }))
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
    [buildMetadata, flushCanvasOps, graphId, selectedSeedOpenalexId, userId],
  );

  const canEditGraphTitle = Boolean(
    // Owned by this browser (anonymous) or by the signed-in account.
    timelineData && graphId && userId && (graphOwnerId === userId || (!!account && graphOwnerId === account.id)),
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
    savingForGraphRef.current = graphId;
    const revision = ++descriptionSaveRef.current;
    const ownsScreen = () => descriptionSaveRef.current === revision && savingForGraphRef.current === graphId;
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
        if (!ownsScreen()) return;
        setSaveState("saved");
        saveStateTimeoutRef.current = window.setTimeout(() => setSaveState("idle"), 1800);
      })
      .catch(() => {
        // Roll back only if this is still the newest save on this canvas: a later edit or another canvas wins.
        if (!ownsScreen()) return;
        graphDescriptionRef.current = previous;
        setGraphDescription(previous);
        descriptionSetByRef.current = previousSetBy;
        setDescriptionSetBy(previousSetBy);
        setSaveState("error");
      });
  }, [buildMetadata, graphId, searchedQuery, timelineData, userId]);


  // A new canvas starts empty. The query becomes the first message to the agent, which decides with
  // the researcher what goes on the board.
  // A new canvas. `seed` starts it with papers already on it (from the feed) and a first message about them;
  // otherwise it is blank and the query is the first message to the agent.
  const startCanvas = useCallback(
    async (query: string, seed?: { papers: GraphPaper[]; notes?: TimelineNote[]; message: string }) => {
      const text = query.trim();
      if (!text || !userId || isSearching) return;
      if (saveTimeoutRef.current) window.clearTimeout(saveTimeoutRef.current);
      if (saveStateTimeoutRef.current) window.clearTimeout(saveStateTimeoutRef.current);
      // A pasted link or ID is not a name; the researcher can rename the canvas from the top bar.
      const looksLikeLink = /^(https?:\/\/|www\.|doi:|arxiv:|10\.\d{4,}\/)/i.test(text) || /^W\d{4,}$/i.test(text);
      const title = looksLikeLink ? "Untitled canvas" : text.length > 60 ? `${text.slice(0, 57).trimEnd()}…` : text;
      const withPapers = (seed?.papers ?? []).reduce<TimelineData>(
        (data, paper, index) => applyTimelineGraphAction(data, {
          type: "add_paper",
          paper,
          x: 80 + (index % 3) * 400,
          y: 80 + Math.floor(index / 3) * 240,
        }),
        createEmptyTimeline(),
      );
      const emptyData = (seed?.notes ?? []).reduce<TimelineData>(
        (data, note) => applyTimelineGraphAction(data, { type: "add_note", note }),
        withPapers,
      );
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
        graphVersionRef.current = savedGraph.version ?? 0;
        pendingOpsRef.current = [];
        opsGraphRef.current = savedGraph.id;
        setGraphId(savedGraph.id);
        setGraphOwnerId(savedGraph.userId);
        setGraphTitle(savedGraph.metadata.title || title);
        graphDescriptionRef.current = "";
        savingForGraphRef.current = null;
        descriptionSaveRef.current += 1;
        setGraphDescription("");
        setDetailAuthors(null, null);
        setGraphTitleDraft("");
        setIsEditingGraphTitle(false);
        setSelectedSeedOpenalexId(null);
        setSaveState("idle");
        persistLastGraphId(savedGraph.id);
        setAgentKickoff({ text: seed?.message ?? text, nonce: Date.now() });
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
    [buildMetadata, isSearching, persistLastGraphId, setDetailAuthors, userId],
  );

  // Synchronize on the feed, or the feed assistant's button: a workspace holding the marked papers, with the
  // researcher's interests handed to the agent as its first message.
  const startCanvasFromFeed = useCallback((papers: FeedPaper[], interests: string) => {
    if (papers.length === 0) return;
    const graphPapers: GraphPaper[] = papers.flatMap((paper) => paper.openalex_id ? [{
      openalexId: paper.openalex_id,
      title: paper.title,
      year: paper.published ? Number(paper.published.slice(0, 4)) || null : null,
      summary: paper.abstract.slice(0, 300),
      detail: paper.abstract,
      authors: paper.authors,
      doi: paper.doi,
    }] : []);
    const list = papers.map((paper) => `- ${paper.title}${paper.published ? ` (${paper.published.slice(0, 4)})` : ""}`).join("\n");
    // Papers OpenAlex does not know cannot be cards; keep each as a note so it is not lost.
    const unplaced = papers.filter((paper) => !paper.openalex_id);
    const rows = Math.ceil(graphPapers.length / 3);
    const notes: TimelineNote[] = unplaced.map((paper, index) => ({
      id: `feed-missing-${Date.now()}-${index}`,
      kind: "todo",
      color: "amber",
      text: [
        `Not in OpenAlex yet: **${paper.title}**`,
        [paper.authors.slice(0, 3).join(", "), paper.published?.slice(0, 4)].filter(Boolean).join(" · "),
        paper.url ? `[Source](${paper.url})` : "",
      ].filter(Boolean).join("\n\n"),
      x: 80 + (index % 3) * 400,
      y: 80 + rows * 240 + Math.floor(index / 3) * 220,
    }));
    const message = [
      `I started this workspace from ${papers.length} paper${papers.length === 1 ? "" : "s"} I marked in my feed:`,
      list,
      unplaced.length ? `${unplaced.length} of them are not in OpenAlex, so they are on the canvas as notes instead of cards.` : "",
      interests.trim() ? `My feed interests: ${interests.trim()}.` : "",
      "Help me see how these relate and what I should look at next.",
    ].filter(Boolean).join("\n\n");
    void startCanvas("From your feed", { papers: graphPapers, notes, message });
  }, [startCanvas]);

  const handleReset = useCallback(() => {
    if (saveTimeoutRef.current) {
      window.clearTimeout(saveTimeoutRef.current);
    }
    if (saveStateTimeoutRef.current) {
      window.clearTimeout(saveStateTimeoutRef.current);
    }
    setTimelineData(null);
    setGraphId(null);
    opsGraphRef.current = null;
    pendingOpsRef.current = [];
    setGraphOwnerId(null);
    setGraphTitle("");
    graphDescriptionRef.current = "";
    savingForGraphRef.current = null;
    descriptionSaveRef.current += 1;
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
  useEffect(() => {
    timelineDataRef.current = timelineData;
  }, [timelineData]);
  const { undoItems, redoItems, record: recordHistory, undo: undoHistory, redo: redoHistory, clear: clearHistory } = useCanvasHistory();

  // Every change goes through here. Passing `history` makes it a step the researcher can undo.
  const commitTimeline = useCallback(
    (op: CanvasOp, via: CanvasOpSource, history?: HistoryMeta | null) => {
      const current = timelineDataRef.current;
      if (!current) return;
      const next = applyCanvasOp(current, op);
      if (next === current) return;
      if (history) recordHistory(current, history);
      pendingOpsRef.current.push({ op: withPaperRefs(current, op), via });
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
    pendingOpsRef.current.push({ op: { type: "restore", data: next }, via: "ui" });
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
    (action: TimelineGraphAction) => commitTimeline(
      { ...action, lockedOpenalexIds: selectedSeedOpenalexId ? [selectedSeedOpenalexId] : [] },
      "ui",
      timelineDataRef.current ? describeGraphAction(timelineDataRef.current, action) : null,
    ),
    [commitTimeline, selectedSeedOpenalexId],
  );

  const handleTimelineLineageChanges = useCallback(
    (changes: LineageChange[]) => {
      if (changes.length === 0) return;
      commitTimeline({
        type: "lineage_changes", changes, lockedOpenalexIds: selectedSeedOpenalexId ? [selectedSeedOpenalexId] : [],
      }, "agent", AGENT_EDIT);
    },
    [commitTimeline, selectedSeedOpenalexId],
  );

  const handleTimelineNoteChanges = useCallback(
    (changes: TimelineNoteChange[]) => {
      if (changes.length === 0) return;
      commitTimeline({ type: "note_changes", changes }, "agent", AGENT_EDIT);
    },
    [commitTimeline],
  );

  const handleTimelineNodeColorChanges = useCallback(
    (changes: TimelineNodeColorChange[]) => {
      if (changes.length === 0) return;
      commitTimeline({ type: "node_color_changes", changes }, "agent", AGENT_EDIT);
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

              <div className="landing-start" ref={setStartBarSlot} />

              <section className="landing-demo hide-mobile" aria-label="What the agent does">
                <LandingDemo />
              </section>

              <section className="landing-feed" aria-label="Paper feed">
                <FeedsView ready={feedReady} startBarTarget={startBarSlot} onSearch={(query) => void startCanvas(query)} onStartWorkspace={startCanvasFromFeed} searching={isSearching} />
              </section>

              <footer className="landing-footer">
                Built by{" "}
                <a href="https://shresth.space" rel="author">Shresth Kapoor</a>
              </footer>
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
