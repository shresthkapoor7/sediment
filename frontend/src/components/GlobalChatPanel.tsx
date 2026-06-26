"use client";

import { useState, useRef, useEffect, useId, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MarkdownContent } from "./MarkdownContent";
import { openChatSession, streamChatAboutTimeline, suggestTimelineQuestions } from "@/lib/api";
import { DETAIL_PANEL_DEFAULT_WIDTH, DETAIL_PANEL_MAX_WIDTH, DETAIL_PANEL_MIN_WIDTH, DETAIL_PANEL_WIDTH_KEY } from "@/lib/detail-panel";
import { GlobalChatStreamEvent, TimelineData } from "@/lib/types";

interface ToolEvent {
  name: string;
  status: string;
  label: string;
}

interface Message {
  id: number | string;
  role: "user" | "assistant";
  text: string;
  highlightedPaperIds?: string[];
  toolEvents?: ToolEvent[];
  statusEvents?: string[];
  citations?: Record<string, unknown>[];
  pending?: boolean;
}

interface GlobalChatPanelProps {
  data: TimelineData;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onHighlight: (ids: string[]) => void;
  onMentionedPaperIdsChange?: (ids: string[]) => void;
  onUsageChanged?: () => void;
  graphId?: string | null;
  userId?: string | null;
}

export function GlobalChatPanel({ data, open, onOpenChange, onHighlight, onMentionedPaperIdsChange, onUsageChanged, graphId, userId }: GlobalChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [mentionedPaperIds, setMentionedPaperIds] = useState<string[]>([]);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionOpen, setMentionOpen] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const msgIdRef = useRef(0);
  const messagesRef = useRef<HTMLDivElement>(null);
  const [panelWidth, setPanelWidth] = useState(DETAIL_PANEL_DEFAULT_WIDTH);
  const panelWidthRef = useRef(DETAIL_PANEL_DEFAULT_WIDTH);
  const panelResizeStateRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setMessages([]);
    if (!graphId || !userId) return () => { cancelled = true; };
    void openChatSession(graphId, userId, "graph")
      .then((session) => {
        if (cancelled) return;
        const restored: Message[] = session.messages.map((message) => {
          const metadata = restoredGlobalMetadata(message.toolUses);
          return {
            id: message.id,
            role: message.role,
            text: message.content,
            highlightedPaperIds: metadata.highlightedPaperIds,
            citations: message.citations,
          };
        });
        setMessages((current) => current.length ? current : restored);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [graphId, userId]);

  useEffect(() => {
    onMentionedPaperIdsChange?.(mentionedPaperIds);
  }, [mentionedPaperIds, onMentionedPaperIdsChange]);

  const inputRef = useRef<HTMLInputElement>(null);
  const panelId = useId();

  const getClampedPanelWidth = useCallback((desiredWidth: number) => {
    const safeMax = Math.min(
      DETAIL_PANEL_MAX_WIDTH,
      Math.max(DETAIL_PANEL_MIN_WIDTH, window.innerWidth - 120),
    );
    return Math.min(safeMax, Math.max(DETAIL_PANEL_MIN_WIDTH, desiredWidth));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const storedWidth = window.localStorage.getItem(DETAIL_PANEL_WIDTH_KEY);
      if (!storedWidth) return;
      const parsed = Number(storedWidth);
      if (Number.isFinite(parsed)) {
        const clamped = getClampedPanelWidth(parsed);
        panelWidthRef.current = clamped;
        setPanelWidth(clamped);
      }
    } catch {
      // Ignore restricted-storage failures and keep the in-memory default.
    }
  }, [getClampedPanelWidth]);

  useEffect(() => {
    panelWidthRef.current = panelWidth;
  }, [panelWidth]);

  const handlePanelResizeStart = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      panelResizeStateRef.current = {
        startX: event.clientX,
        startWidth: panelWidth,
      };

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const current = panelResizeStateRef.current;
        if (!current) return;
        const nextWidth = getClampedPanelWidth(current.startWidth - (moveEvent.clientX - current.startX));
        panelWidthRef.current = nextWidth;
        setPanelWidth(nextWidth);
      };

      const handlePointerUp = () => {
        panelResizeStateRef.current = null;
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
        try {
          window.localStorage.setItem(DETAIL_PANEL_WIDTH_KEY, String(panelWidthRef.current));
        } catch {
          // Ignore restricted-storage failures and keep the in-memory width.
        }
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
    },
    [getClampedPanelWidth, panelWidth],
  );

  useEffect(() => {
    if (open) {
      if (messages.length === 0 && suggestions.length === 0) {
        setLoadingSuggestions(true);
        suggestTimelineQuestions(papers)
          .then(setSuggestions)
          .finally(() => setLoadingSuggestions(false));
      }
    } else {
      setMentionedPaperIds([]);
      setMentionOpen(false);
      setMentionQuery("");
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const messagesEl = messagesRef.current;
    if (!messagesEl) return;
    messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: "smooth" });
  }, [messages, isThinking]);

  const papers = Object.values(data.nodes).map((n) => ({
    openalexId: n.paper.openalexId,
    title: n.paper.title,
    year: n.paper.year,
    summary: n.paper.summary,
  }));
  const selectedMentionPapers = mentionedPaperIds
    .map((id) => papers.find((paper) => paper.openalexId === id))
    .filter((paper): paper is (typeof papers)[number] => Boolean(paper));
  const mentionOptions = papers
    .filter((paper) => !mentionedPaperIds.includes(paper.openalexId))
    .filter((paper) => {
      const query = mentionQuery.trim().toLowerCase();
      if (!query) return true;
      return (
        paper.title.toLowerCase().includes(query) ||
        String(paper.year ?? "").includes(query)
      );
    })
    .slice(0, 8);

  const updateMentionSearch = useCallback((value: string, cursor: number | null) => {
    const activeMention = getActiveMention(value, cursor ?? value.length);
    if (!activeMention) {
      setMentionOpen(false);
      setMentionQuery("");
      return;
    }
    setMentionOpen(true);
    setMentionQuery(activeMention.query);
  }, []);

  const selectMention = useCallback((paper: (typeof papers)[number]) => {
    const cursor = inputRef.current?.selectionStart ?? input.length;
    const activeMention = getActiveMention(input, cursor);
    const nextInput = activeMention
      ? `${input.slice(0, activeMention.start)}${input.slice(cursor)}`.replace(/\s{2,}/g, " ").trimStart()
      : input;

    setInput(nextInput);
    setMentionedPaperIds((current) => current.includes(paper.openalexId) ? current : [...current, paper.openalexId]);
    setMentionOpen(false);
    setMentionQuery("");
    window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 0);
  }, [input, papers]);

  const removeMention = useCallback((paperId: string) => {
    setMentionedPaperIds((current) => current.filter((id) => id !== paperId));
  }, []);

  async function send() {
    const q = input.trim() || (mentionedPaperIds.length > 0 ? "Tell me about the mentioned paper(s)." : "");
    if (!q || isThinking) return;
    const focusedPaperIds = mentionedPaperIds;
    setInput("");
    setMentionedPaperIds([]);
    setMentionOpen(false);
    setMentionQuery("");

    const mentionedTitles = focusedPaperIds
      .map((id) => papers.find((paper) => paper.openalexId === id))
      .filter((paper): paper is (typeof papers)[number] => Boolean(paper))
      .map((paper) => `@${paper.title}`);
    const displayText = [mentionedTitles.join(" "), q].filter(Boolean).join(" ");
    const userMsg: Message = { id: `local-${++msgIdRef.current}`, role: "user", text: displayText };
    const assistantId = `local-${++msgIdRef.current}`;
    const assistantMsg: Message = { id: assistantId, role: "assistant", text: "", pending: true };
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setIsThinking(true);
    onHighlight([]);

    const updateAssistant = (patch: Partial<Message>) => {
      setMessages((prev) => prev.map((message) => (
        message.id === assistantId ? { ...message, ...patch } : message
      )));
    };
    const appendStatus = (status: string) => {
      setMessages((prev) => prev.map((message) => (
        message.id === assistantId
          ? { ...message, statusEvents: [...(message.statusEvents ?? []), status].slice(-5) }
          : message
      )));
    };
    const upsertTool = (tool: ToolEvent) => {
      setMessages((prev) => prev.map((message) => {
        if (message.id !== assistantId) return message;
        const existing = message.toolEvents ?? [];
        const priorIndex = existing.findIndex((item) => item.name === tool.name);
        const next = priorIndex >= 0
          ? existing.map((item, index) => index === priorIndex ? tool : item)
          : [...existing, tool];
        return { ...message, toolEvents: next };
      }));
    };

    try {
      const res = await streamChatAboutTimeline(
        papers,
        q,
        (event: GlobalChatStreamEvent) => {
          if (event.type === "status") appendStatus(event.message);
          if (event.type === "tool_started") {
            upsertTool({ name: event.name, status: "started", label: globalToolLabel(event.name) });
          }
          if (event.type === "tool_completed") {
            upsertTool({
              name: event.name,
              status: event.status ?? "completed",
              label: globalToolLabel(event.name, event.status, event.result),
            });
          }
          if (event.type === "text_delta") {
            setMessages((prev) => prev.map((message) => (
              message.id === assistantId
                ? { ...message, text: `${message.text}${event.text}` }
                : message
            )));
          }
          if (event.type === "citations") updateAssistant({ citations: event.citations });
          if (event.type === "message_completed") {
            updateAssistant({
              text: event.response.text,
              highlightedPaperIds: event.response.highlightedPaperIds,
              citations: event.response.citations ?? [],
              pending: false,
            });
            if (event.response.highlightedPaperIds.length > 0) {
              onHighlight(event.response.highlightedPaperIds);
            }
          }
          if (event.type === "error") {
            updateAssistant({ text: event.detail || "Chat failed", pending: false });
          }
        },
        graphId && userId ? { graphId, userId } : undefined,
        focusedPaperIds,
      );
      if (res) {
        updateAssistant({
          text: res.text,
          highlightedPaperIds: res.highlightedPaperIds,
          citations: res.citations ?? [],
          pending: false,
        });
      }
      if (res?.highlightedPaperIds && res.highlightedPaperIds.length > 0) {
        onHighlight(res.highlightedPaperIds);
      }
    } catch (error) {
      updateAssistant({
        text: error instanceof Error ? error.message : "Something went wrong. Try again.",
        pending: false,
      });
    } finally {
      setIsThinking(false);
      onUsageChanged?.();
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (mentionOpen && e.key === "Escape") {
      e.preventDefault();
      setMentionOpen(false);
      setMentionQuery("");
      return;
    }
    if (mentionOpen && e.key === "Enter" && mentionOptions[0]) {
      e.preventDefault();
      selectMention(mentionOptions[0]);
      return;
    }
    if (e.key === "Backspace" && !input && mentionedPaperIds.length > 0) {
      e.preventDefault();
      setMentionedPaperIds((current) => current.slice(0, -1));
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  function handleClose() {
    onOpenChange(false);
    onHighlight([]);
    setMentionedPaperIds([]);
    setMentionOpen(false);
    setMentionQuery("");
  }

  return (
    <div
      data-canvas-ui="true"
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        zIndex: 22,
        pointerEvents: "none",
      }}
    >
      <AnimatePresence>
        {open && (
          <motion.div
            id={panelId}
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
            onWheelCapture={(e) => e.stopPropagation()}
            style={{
              position: "absolute",
              top: 0,
              right: 0,
              bottom: 0,
              width: `min(${panelWidth}px, 100vw)`,
              height: "100%",
              background: "var(--bg-primary)",
              borderLeft: "0.0625rem solid var(--border)",
              boxShadow: "-0.75rem 0 2.5rem rgba(0,0,0,0.16)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              pointerEvents: "auto",
            }}
          >
            <div
              data-canvas-ui="true"
              onPointerDown={handlePanelResizeStart}
              style={{
                position: "absolute",
                top: 0,
                left: "-0.375rem",
                bottom: 0,
                width: "0.75rem",
                cursor: "ew-resize",
                zIndex: 1,
                touchAction: "none",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  top: "50%",
                  left: "50%",
                  transform: "translate(-50%, -50%)",
                  width: "0.1875rem",
                  height: "3rem",
                  borderRadius: "999px",
                  background: "var(--border-hover)",
                  opacity: 0.9,
                }}
              />
            </div>

            {/* Header */}
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              padding: "0.625rem 0.875rem",
              borderBottom: "0.0625rem solid var(--border)",
              flexShrink: 0,
            }}>
              <motion.div
                initial={false}
                animate={{ rotate: 180 }}
                transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
                style={{
                  width: "1.25rem",
                  height: "1.25rem",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
                  <rect x="2"  y="4"  width="16" height="3" rx="1.5" fill="var(--accent)" opacity="1" />
                  <rect x="4"  y="9"  width="12" height="3" rx="1.5" fill="var(--accent)" opacity="0.7" />
                  <rect x="6"  y="14" width="8"  height="3" rx="1.5" fill="var(--accent)" opacity="0.4" />
                </svg>
              </motion.div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-primary)", fontFamily: "'DM Sans', sans-serif" }}>
                  Timeline chat
                </div>
                <div style={{ fontSize: "0.625rem", color: "var(--text-tertiary)", fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.03em" }}>
                  Ask globally, or mention papers with @
                </div>
              </div>
              <button
                onClick={handleClose}
                aria-label="Close chat"
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  color: "var(--text-tertiary)", padding: "0.25rem", borderRadius: "0.375rem",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <path d="M3 3l10 10M13 3L3 13" />
                </svg>
              </button>
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.5rem",
                padding: "0.75rem 0.875rem",
                borderBottom: "0.0625rem solid var(--border)",
                background: "var(--bg-secondary)",
                flexShrink: 0,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem" }}>
                <span
                  style={{
                    fontSize: "0.625rem",
                    color: "var(--text-tertiary)",
                    fontFamily: "'JetBrains Mono', monospace",
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                  }}
                >
                  Context
                </span>
                <span
                  style={{
                    fontSize: "0.625rem",
                    color: "var(--text-tertiary)",
                    fontFamily: "'JetBrains Mono', monospace",
                  }}
                >
                  {papers.length} paper{papers.length !== 1 ? "s" : ""}
                </span>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.375rem" }}>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.375rem",
                    borderRadius: "999px",
                    border: "0.0625rem solid var(--accent)",
                    background: "var(--accent-soft)",
                    color: "var(--accent)",
                    padding: "0.25rem 0.55rem",
                    fontSize: "0.6875rem",
                    fontFamily: "'DM Sans', sans-serif",
                    fontWeight: 600,
                  }}
                >
                  All timeline
                </span>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    borderRadius: "999px",
                    border: "0.0625rem dashed var(--border-hover)",
                    color: "var(--text-tertiary)",
                    padding: "0.25rem 0.55rem",
                    fontSize: "0.6875rem",
                    fontFamily: "'JetBrains Mono', monospace",
                  }}
                >
                  @ paper mentions
                </span>
              </div>
            </div>

            {/* Messages */}
            <div ref={messagesRef} style={{ flex: 1, overflowY: "auto", padding: "0.625rem 0.875rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {messages.length === 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem", marginTop: "0.25rem" }}>
                  {loadingSuggestions ? (
                    [0, 1, 2].map((i) => (
                      <div key={i} style={{
                        height: "2.125rem",
                        borderRadius: "0.5rem",
                        background: "var(--bg-secondary)",
                        border: "0.0625rem solid var(--border)",
                        opacity: 0.5 + i * 0.15,
                      }} />
                    ))
                  ) : suggestions.map((hint) => (
                    <button
                      key={hint}
                      onClick={() => { setInput(hint); inputRef.current?.focus({ preventScroll: true }); }}
                      style={{
                        textAlign: "left",
                        background: "var(--bg-secondary)",
                        border: "0.0625rem solid var(--border)",
                        borderRadius: "0.5rem",
                        padding: "0.4375rem 0.625rem",
                        fontSize: "0.71875rem",
                        color: "var(--text-secondary)",
                        fontFamily: "'DM Sans', sans-serif",
                        cursor: "pointer",
                        transition: "border-color 0.15s, color 0.15s",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.color = "var(--accent)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = "var(--text-secondary)"; }}
                    >
                      {hint}
                    </button>
                  ))}
                </div>
              )}

              {messages.map((msg) => (
                <div key={msg.id} style={{ display: "flex", flexDirection: "column", gap: "0.25rem", alignItems: msg.role === "user" ? "flex-end" : "flex-start" }}>
                  <div style={{
                    maxWidth: "88%",
                    padding: "0.4375rem 0.625rem",
                    borderRadius: msg.role === "user" ? "0.625rem 0.625rem 0.1875rem 0.625rem" : "0.625rem 0.625rem 0.625rem 0.1875rem",
                    background: msg.role === "user" ? "var(--accent)" : "var(--bg-secondary)",
                    color: msg.role === "user" ? "white" : "var(--text-primary)",
                    fontSize: "0.78125rem",
                    lineHeight: 1.5,
                    fontFamily: "'DM Sans', sans-serif",
                  }}>
                    {msg.role === "assistant" ? (
                      <MarkdownContent>{msg.text}</MarkdownContent>
                    ) : msg.text}
                  </div>

                  {msg.highlightedPaperIds && msg.highlightedPaperIds.length > 0 && (
                    <button
                      onClick={() => onHighlight(msg.highlightedPaperIds!)}
                      style={{
                        background: "none",
                        border: "none",
                        padding: "0.125rem 0.25rem",
                        fontSize: "0.65625rem",
                        color: "var(--accent)",
                        fontFamily: "'JetBrains Mono', monospace",
                        cursor: "pointer",
                        textDecoration: "underline",
                        textDecorationStyle: "dotted",
                        textUnderlineOffset: "0.1875rem",
                      }}
                    >
                      ↑ {msg.highlightedPaperIds.length} paper{msg.highlightedPaperIds.length !== 1 ? "s" : ""} highlighted
                    </button>
                  )}

                  {(msg.pending || (msg.toolEvents?.length ?? 0) > 0 || (msg.statusEvents?.length ?? 0) > 0) && (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "0.3125rem",
                        maxWidth: "88%",
                        padding: "0.125rem 0.25rem",
                      }}
                    >
                      {(msg.statusEvents ?? []).slice(-2).map((status, index) => (
                        <div key={`${msg.id}-status-${index}`} style={{ display: "flex", alignItems: "center", gap: "0.375rem", color: "var(--text-tertiary)", fontSize: "0.65625rem", fontFamily: "'JetBrains Mono', monospace" }}>
                          <span style={{ width: "0.35rem", height: "0.35rem", borderRadius: "50%", background: msg.pending ? "var(--accent)" : "var(--text-tertiary)", display: "inline-block" }} />
                          {status}
                        </div>
                      ))}
                      {(msg.toolEvents ?? []).map((tool) => (
                        <div key={`${msg.id}-${tool.name}`} style={{ display: "flex", alignItems: "center", gap: "0.375rem", color: "var(--text-secondary)", fontSize: "0.6875rem", fontFamily: "'DM Sans', sans-serif" }}>
                          <span style={{ color: tool.status === "started" ? "var(--accent)" : tool.status === "error" ? "var(--danger, #b45309)" : "var(--text-tertiary)" }}>
                            {tool.status === "started" ? "↻" : tool.status === "error" ? "!" : "✓"}
                          </span>
                          {tool.label}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}

              {isThinking && (
                <div style={{ display: "flex", gap: "0.25rem", padding: "0.375rem 0.125rem", alignItems: "center" }}>
                  {[0, 1, 2].map((i) => (
                    <motion.div
                      key={i}
                      animate={{ opacity: [0.3, 1, 0.3] }}
                      transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
                      style={{ width: "0.3125rem", height: "0.3125rem", borderRadius: "50%", background: "var(--accent)" }}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Input bar */}
            <div style={{ position: "relative", padding: "0.75rem 1rem", borderTop: "0.0625rem solid var(--border)", flexShrink: 0 }}>
              <AnimatePresence>
                {mentionOpen && mentionOptions.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: 8, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 8, scale: 0.98 }}
                    transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                    style={{
                      position: "absolute",
                      left: "1rem",
                      right: "1rem",
                      bottom: "4.25rem",
                      zIndex: 4,
                      borderRadius: "0.875rem",
                      border: "0.0625rem solid var(--border)",
                      background: "var(--bg-primary)",
                      boxShadow: "0 1rem 2.5rem rgba(0,0,0,0.18)",
                      overflow: "hidden",
                    }}
                  >
                    {mentionOptions.map((paper, index) => (
                      <button
                        key={paper.openalexId}
                        type="button"
                        onMouseDown={(event) => {
                          event.preventDefault();
                          selectMention(paper);
                        }}
                        style={{
                          width: "100%",
                          display: "flex",
                          alignItems: "center",
                          gap: "0.625rem",
                          padding: "0.625rem 0.75rem",
                          border: "none",
                          borderTop: index === 0 ? "none" : "0.0625rem solid var(--border)",
                          background: "transparent",
                          color: "var(--text-primary)",
                          cursor: "pointer",
                          textAlign: "left",
                        }}
                        onMouseEnter={(event) => {
                          event.currentTarget.style.background = "var(--bg-secondary)";
                        }}
                        onMouseLeave={(event) => {
                          event.currentTarget.style.background = "transparent";
                        }}
                      >
                        <span
                          style={{
                            flexShrink: 0,
                            minWidth: "2.5rem",
                            color: "var(--accent)",
                            fontFamily: "'JetBrains Mono', monospace",
                            fontSize: "0.6875rem",
                          }}
                        >
                          {paper.year ?? "----"}
                        </span>
                        <span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: "0.125rem" }}>
                          <span
                            style={{
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              fontFamily: "'DM Sans', sans-serif",
                              fontSize: "0.78125rem",
                              fontWeight: 600,
                            }}
                          >
                            {paper.title}
                          </span>
                          <span
                            style={{
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              color: "var(--text-tertiary)",
                              fontFamily: "'JetBrains Mono', monospace",
                              fontSize: "0.625rem",
                            }}
                          >
                            {paper.openalexId}
                          </span>
                        </span>
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void send();
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    flexWrap: "wrap",
                    background: "var(--bg-secondary)",
                    border: "0.0625rem solid var(--border)",
                    borderRadius: "0.625rem",
                    padding: "0.5625rem 0.75rem",
                    transition: "border-color 0.15s",
                  }}
                >
                  {selectedMentionPapers.map((paper) => (
                    <button
                      key={paper.openalexId}
                      type="button"
                      onClick={() => removeMention(paper.openalexId)}
                      title={`Remove ${paper.title}`}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "0.375rem",
                        maxWidth: "100%",
                        padding: "0.25rem 0.5rem",
                        borderRadius: "999px",
                        border: "0.0625rem solid var(--accent)",
                        background: "var(--accent-soft)",
                        color: "var(--accent)",
                        cursor: "pointer",
                        fontFamily: "'DM Sans', sans-serif",
                        fontSize: "0.6875rem",
                        fontWeight: 600,
                      }}
                    >
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "0.625rem" }}>
                        @{paper.year ?? "paper"}
                      </span>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "10rem" }}>
                        {paper.title}
                      </span>
                      <span aria-hidden="true" style={{ color: "var(--text-tertiary)" }}>×</span>
                    </button>
                  ))}
                  <input
                    ref={inputRef}
                    type="text"
                    value={input}
                    onChange={(e) => {
                      setInput(e.target.value);
                      updateMentionSearch(e.target.value, e.target.selectionStart);
                    }}
                    onClick={(e) => updateMentionSearch(input, e.currentTarget.selectionStart)}
                    onKeyUp={(e) => updateMentionSearch(input, e.currentTarget.selectionStart)}
                    onKeyDown={handleKey}
                    placeholder="Ask, or @ papers to focus context..."
                    disabled={isThinking}
                    style={{
                      flex: 1,
                      background: "none",
                      border: "none",
                      outline: "none",
                      color: "var(--text-primary)",
                      fontSize: "0.8125rem",
                      fontFamily: "'DM Sans', sans-serif",
                    }}
                  />
                  <button
                    type="submit"
                    aria-label="Send message"
                    disabled={isThinking || (!input.trim() && mentionedPaperIds.length === 0)}
                    style={{
                      background: "var(--accent)",
                      border: "none",
                      borderRadius: "0.375rem",
                      width: "1.75rem",
                      height: "1.75rem",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: input.trim() || mentionedPaperIds.length > 0 ? "pointer" : "default",
                      flexShrink: 0,
                      opacity: input.trim() || mentionedPaperIds.length > 0 ? 1 : 0,
                      transition: "opacity 0.15s",
                      pointerEvents: input.trim() || mentionedPaperIds.length > 0 ? "auto" : "none",
                    }}
                  >
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 8H2M8 2l6 6-6 6" />
                    </svg>
                  </button>
                </div>
              </form>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}

function getActiveMention(value: string, cursor: number): { start: number; query: string } | null {
  const beforeCursor = value.slice(0, cursor);
  const atIndex = beforeCursor.lastIndexOf("@");
  if (atIndex < 0) return null;
  const charBeforeAt = atIndex > 0 ? beforeCursor[atIndex - 1] : " ";
  if (charBeforeAt && !/\s/.test(charBeforeAt)) return null;
  const query = beforeCursor.slice(atIndex + 1);
  if (/\s/.test(query)) return null;
  return { start: atIndex, query };
}

function restoredGlobalMetadata(toolUses: Record<string, unknown>[]): {
  highlightedPaperIds: string[];
} {
  const metadata = toolUses.find((item) => item.name === "global_response");
  const highlighted = Array.isArray(metadata?.highlightedPaperIds)
    ? metadata.highlightedPaperIds.filter((value): value is string => typeof value === "string")
    : [];
  return { highlightedPaperIds: highlighted };
}

function globalToolLabel(name: string, status?: string, result?: Record<string, unknown>): string {
  if (name === "check_paper_access") return status === "started" ? "Checking paper access" : "Checked paper access";
  if (name === "retrieve_paper_content") {
    if (status === "needs_confirmation") return "Complete paper access needs confirmation";
    return status === "started" ? "Accessing and indexing complete paper" : "Paper access finished";
  }
  if (name === "search_paper_content") {
    const count = typeof result?.matchCount === "number" ? result.matchCount : null;
    return count === null ? "Searching paper content" : `Searched paper content · ${count} matches`;
  }
  if (name === "web_search") return "Searched public sources";
  return "Ran tool";
}
