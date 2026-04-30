"use client";

import { useState, useRef, useEffect, useId } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MarkdownContent } from "./MarkdownContent";
import { chatAboutTimeline, suggestTimelineQuestions } from "@/lib/api";
import { ChatSuggestion, TimelineData } from "@/lib/types";

interface Message {
  id: number;
  role: "user" | "assistant";
  text: string;
  highlightedPaperIds?: string[];
  suggestion?: ChatSuggestion | null;
}

interface GlobalChatPanelProps {
  data: TimelineData;
  onHighlight: (ids: string[]) => void;
  onAddLineage: (query: string) => void;
  isExpanding: boolean;
  onUsageChanged?: () => void;
}

export function GlobalChatPanel({ data, onHighlight, onAddLineage, isExpanding, onUsageChanged }: GlobalChatPanelProps) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const msgIdRef = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);
  const [expandingMsgId, setExpandingMsgId] = useState<number | null>(null);

  useEffect(() => {
    if (!isExpanding && expandingMsgId !== null) {
      setMessages((prev) => prev.map((m) => m.id === expandingMsgId ? { ...m, suggestion: null } : m));
      setExpandingMsgId(null);
    }
  }, [isExpanding, expandingMsgId]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100);
      if (messages.length === 0 && suggestions.length === 0) {
        setLoadingSuggestions(true);
        suggestTimelineQuestions(papers)
          .then(setSuggestions)
          .finally(() => setLoadingSuggestions(false));
      }
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isThinking]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(el.scrollHeight, 120);
    el.style.height = `${next}px`;
    el.style.overflow = el.scrollHeight > 120 ? "auto" : "hidden";
  }, [input, open]);

  const papers = Object.values(data.nodes).map((n) => ({
    openalexId: n.paper.openalexId,
    title: n.paper.title,
    year: n.paper.year,
    summary: n.paper.summary,
  }));

  async function send() {
    const q = input.trim();
    if (!q || isThinking) return;
    setInput("");

    const userMsg: Message = { id: ++msgIdRef.current, role: "user", text: q };
    setMessages((prev) => [...prev, userMsg]);
    setIsThinking(true);
    onHighlight([]);

    try {
      const res = await chatAboutTimeline(papers, q);
      const assistantMsg: Message = {
        id: ++msgIdRef.current,
        role: "assistant",
        text: res.text,
        highlightedPaperIds: res.highlightedPaperIds,
        suggestion: res.suggestion,
      };
      setMessages((prev) => [...prev, assistantMsg]);
      if (res.highlightedPaperIds.length > 0) {
        onHighlight(res.highlightedPaperIds);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { id: ++msgIdRef.current, role: "assistant", text: "Something went wrong. Try again." },
      ]);
    } finally {
      setIsThinking(false);
      onUsageChanged?.();
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  function handleClose() {
    setOpen(false);
    onHighlight([]);
  }

  return (
    <div
      data-canvas-ui="true"
      style={{ position: "absolute", bottom: "1.25rem", right: "1.25rem", zIndex: 50, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.5rem" }}
    >
      <AnimatePresence>
        {open && (
          <motion.div
            id={panelId}
            initial={{ opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.97 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            onWheelCapture={(e) => e.stopPropagation()}
            style={{
              width: "min(20rem, calc(100vw - 2.5rem))",
              maxHeight: "26.25rem",
              background: "var(--bg-primary)",
              border: "0.0625rem solid var(--border-hover)",
              borderRadius: "0.875rem",
              boxShadow: "0 1rem 3rem rgba(0,0,0,0.18), 0 0.25rem 0.75rem rgba(0,0,0,0.10)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
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
                  Ask about this timeline
                </div>
                <div style={{ fontSize: "0.625rem", color: "var(--text-tertiary)", fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.03em" }}>
                  {papers.length} paper{papers.length !== 1 ? "s" : ""} in context
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

            {/* Messages */}
            <div style={{ flex: 1, overflowY: "auto", padding: "0.625rem 0.875rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
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
                      onClick={() => { setInput(hint); inputRef.current?.focus(); }}
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

                  {msg.suggestion && (
                    <div style={{
                      background: "var(--accent-soft)",
                      border: "0.0625rem solid var(--accent)",
                      borderRadius: "0.5rem",
                      padding: "0.5rem 0.625rem",
                      maxWidth: "88%",
                      display: "flex",
                      flexDirection: "column",
                      gap: "0.3125rem",
                    }}>
                      <div style={{ fontSize: "0.6875rem", color: "var(--accent)", fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.03em" }}>
                        suggested lineage
                      </div>
                      <div style={{ fontSize: "0.78125rem", fontWeight: 600, color: "var(--text-primary)", fontFamily: "'DM Sans', sans-serif" }}>
                        {msg.suggestion.topic}
                      </div>
                      <button
                        onClick={() => {
                          if (isExpanding) return;
                          onAddLineage(msg.suggestion!.query);
                          onHighlight([]);
                          setExpandingMsgId(msg.id);
                        }}
                        disabled={isExpanding}
                        style={{
                          alignSelf: "flex-start",
                          background: "var(--accent)",
                          border: "none",
                          borderRadius: "0.375rem",
                          padding: "0.25rem 0.625rem",
                          fontSize: "0.6875rem",
                          fontWeight: 600,
                          color: "white",
                          cursor: isExpanding ? "default" : "pointer",
                          fontFamily: "'DM Sans', sans-serif",
                          display: "flex",
                          alignItems: "center",
                          gap: "0.375rem",
                          opacity: expandingMsgId === msg.id ? 0.7 : 1,
                        }}
                      >
                        {expandingMsgId === msg.id ? (
                          <>
                            <motion.div
                              animate={{ rotate: 360 }}
                              transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                              style={{ width: "0.625rem", height: "0.625rem", border: "0.09375rem solid rgba(255,255,255,0.4)", borderTopColor: "white", borderRadius: "50%" }}
                            />
                            Adding...
                          </>
                        ) : "Add lineage"}
                      </button>
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

              <div ref={endRef} />
            </div>

            {/* Input */}
            <div style={{
              display: "flex",
              gap: "0.375rem",
              padding: "0.5rem 0.625rem",
              borderTop: "0.0625rem solid var(--border)",
              flexShrink: 0,
              alignItems: "flex-end",
            }}>
              <textarea
                ref={inputRef}
                value={input}
                rows={1}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKey}
                placeholder="Ask about these papers..."
                style={{
                  flex: 1,
                  background: "var(--bg-secondary)",
                  border: "0.0625rem solid var(--border)",
                  borderRadius: "0.5rem",
                  padding: "0.375rem 0.625rem",
                  fontSize: "0.75rem",
                  color: "var(--text-primary)",
                  fontFamily: "'DM Sans', sans-serif",
                  outline: "none",
                  resize: "none",
                  overflow: "hidden",
                  lineHeight: 1.5,
                  maxHeight: 120,
                }}
                onFocus={(e) => { e.target.style.borderColor = "var(--accent)"; }}
                onBlur={(e) => { e.target.style.borderColor = "var(--border)"; }}
              />
              <button
                onClick={() => void send()}
                aria-label="Send message"
                disabled={!input.trim() || isThinking}
                style={{
                  width: "1.875rem",
                  height: "1.875rem",
                  background: input.trim() && !isThinking ? "var(--accent)" : "var(--bg-tertiary)",
                  border: "none",
                  borderRadius: "0.5rem",
                  cursor: input.trim() && !isThinking ? "pointer" : "default",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  transition: "background 0.15s",
                  flexShrink: 0,
                }}
              >
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 8h12M9 3l5 5-5 5" />
                </svg>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Clippy button */}
      <motion.button
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close timeline chat" : "Open timeline chat"}
        aria-expanded={open}
        aria-controls={panelId}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        animate={{ rotate: open ? 180 : 0 }}
        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        style={{
          width: "2rem",
          height: "2rem",
          background: "none",
          border: "none",
          boxShadow: "none",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "transform 0.2s",
          flexShrink: 0,
          padding: 0,
        }}
      >
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
          {/* strata layers — geological sediment */}
          <rect x="2"  y="4"  width="16" height="3" rx="1.5" fill="var(--accent)" opacity={open ? "1" : "0.92"} />
          <rect x="4"  y="9"  width="12" height="3" rx="1.5" fill="var(--accent)" opacity={open ? "0.78" : "0.66"} />
          <rect x="6"  y="14" width="8"  height="3" rx="1.5" fill="var(--accent)" opacity={open ? "0.58" : "0.42"} />
        </svg>
      </motion.button>
    </div>
  );
}
