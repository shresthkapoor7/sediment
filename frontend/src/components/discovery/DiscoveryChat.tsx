"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { m, AnimatePresence } from "framer-motion";
import { LogoMark } from "@/components/LogoMark";
import {
  DETAIL_PANEL_DEFAULT_WIDTH,
  DETAIL_PANEL_MAX_WIDTH,
  DETAIL_PANEL_MIN_WIDTH,
  DETAIL_PANEL_WIDTH_KEY,
} from "@/lib/detail-panel";
import type { DiscoveryGraph } from "@/lib/discovery";

interface Message {
  id: number;
  role: "user" | "assistant";
  text: string;
}

interface DiscoveryChatProps {
  open: boolean;
  onClose: () => void;
  graph: DiscoveryGraph;
}

/** Mirrors GlobalChatPanel — resizable right overlay, same header/bubbles/input.
 *  Replies are canned until the backend chat endpoint is wired up. */
export function DiscoveryChat({ open, onClose, graph }: DiscoveryChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const idRef = useRef(0);
  const messagesRef = useRef<HTMLDivElement>(null);

  const [panelWidth, setPanelWidth] = useState(DETAIL_PANEL_DEFAULT_WIDTH);
  const panelWidthRef = useRef(DETAIL_PANEL_DEFAULT_WIDTH);
  const resizeStateRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const suggestions = [
    "What connects RL and Search & Planning?",
    "Summarize the LLM papers",
    "What's the newest breakthrough?",
  ];

  const getClampedWidth = useCallback((desired: number) => {
    const safeMax = Math.min(DETAIL_PANEL_MAX_WIDTH, Math.max(DETAIL_PANEL_MIN_WIDTH, window.innerWidth - 120));
    return Math.min(safeMax, Math.max(DETAIL_PANEL_MIN_WIDTH, desired));
  }, []);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(DETAIL_PANEL_WIDTH_KEY);
      if (!stored) return;
      const parsed = Number(stored);
      if (Number.isFinite(parsed)) {
        const clamped = getClampedWidth(parsed);
        panelWidthRef.current = clamped;
        setPanelWidth(clamped);
      }
    } catch {
      // ignore restricted storage
    }
  }, [getClampedWidth]);

  useEffect(() => {
    panelWidthRef.current = panelWidth;
  }, [panelWidth]);

  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const handleResizeStart = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      resizeStateRef.current = { startX: event.clientX, startWidth: panelWidth };
      const onMove = (moveEvent: PointerEvent) => {
        const state = resizeStateRef.current;
        if (!state) return;
        const next = getClampedWidth(state.startWidth - (moveEvent.clientX - state.startX));
        panelWidthRef.current = next;
        setPanelWidth(next);
      };
      const onUp = () => {
        resizeStateRef.current = null;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        try {
          window.localStorage.setItem(DETAIL_PANEL_WIDTH_KEY, String(panelWidthRef.current));
        } catch {
          // ignore restricted storage
        }
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [getClampedWidth, panelWidth],
  );

  const send = (text: string) => {
    const q = text.trim();
    if (!q) return;
    setMessages((m) => [
      ...m,
      { id: ++idRef.current, role: "user", text: q },
      { id: ++idRef.current, role: "assistant", text: respond(q, graph) },
    ]);
    setInput("");
  };

  return (
    <div style={{ position: "absolute", inset: "0 0 0 auto", zIndex: 60, pointerEvents: "none" }}>
      <AnimatePresence>
        {open && (
          <m.div
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
              background: "var(--bg-primary)",
              borderLeft: "0.0625rem solid var(--border)",
              boxShadow: "-0.75rem 0 2.5rem rgba(0,0,0,0.16)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              pointerEvents: "auto",
            }}
          >
            {/* Resize handle */}
            <div
              onPointerDown={handleResizeStart}
              style={{ position: "absolute", top: 0, left: "-0.375rem", bottom: 0, width: "0.75rem", cursor: "ew-resize", zIndex: 1, touchAction: "none" }}
            >
              <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: "0.1875rem", height: "3rem", borderRadius: "999px", background: "var(--border-hover)", opacity: 0.9 }} />
            </div>

            {/* Header */}
            <div style={{ position: "relative", display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.625rem 0.875rem", borderBottom: "0.0625rem solid var(--border)", flexShrink: 0 }}>
              <div style={{ width: "1.25rem", height: "1.25rem", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <LogoMark width="18" height="18" style={{ color: "var(--text-primary)" }} />
              </div>
              <div style={{ position: "absolute", left: "50%", transform: "translateX(-50%)", pointerEvents: "none" }}>
                <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-primary)", fontFamily: "var(--font-sans), sans-serif" }}>Sediment Agent</div>
              </div>
              <div style={{ flex: 1 }} />
              <button
                onClick={onClose}
                aria-label="Close chat"
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-tertiary)", padding: "0.25rem", borderRadius: "0.375rem", display: "flex", alignItems: "center", justifyContent: "center" }}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <path d="M3 3l10 10M13 3L3 13" />
                </svg>
              </button>
            </div>

            {/* Context line */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", padding: "0.75rem 0.875rem", borderBottom: "0.0625rem solid var(--border)", background: "var(--bg-secondary)", flexShrink: 0 }}>
              <span style={{ fontSize: "0.625rem", color: "var(--text-tertiary)", fontFamily: "var(--font-mono), monospace", letterSpacing: "0.06em", textTransform: "uppercase" }}>Context</span>
              <span style={{ fontSize: "0.625rem", color: "var(--text-tertiary)", fontFamily: "var(--font-mono), monospace" }}>
                {graph.topics.length} sub-fields · {graph.papers.length} papers
              </span>
            </div>

            {/* Messages */}
            <div ref={messagesRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0.625rem 0.875rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {messages.length === 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem", marginTop: "0.25rem" }}>
                  {suggestions.map((hint) => (
                    <button
                      key={hint}
                      onClick={() => send(hint)}
                      style={{ textAlign: "left", background: "var(--bg-secondary)", border: "0.0625rem solid var(--border)", borderRadius: "0.5rem", padding: "0.4375rem 0.625rem", fontSize: "0.71875rem", color: "var(--text-secondary)", fontFamily: "var(--font-sans), sans-serif", cursor: "pointer", transition: "border-color 0.15s, color 0.15s" }}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--border-hover)"; e.currentTarget.style.color = "var(--text-primary)"; e.currentTarget.style.background = "var(--bg-tertiary)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = "var(--text-secondary)"; e.currentTarget.style.background = "var(--bg-secondary)"; }}
                    >
                      {hint}
                    </button>
                  ))}
                </div>
              )}

              {messages.map((msg) => (
                <div key={msg.id} style={{ display: "flex", flexDirection: "column", gap: "0.25rem", alignItems: msg.role === "user" ? "flex-end" : "flex-start" }}>
                  <div
                    style={{
                      maxWidth: "88%",
                      padding: "0.4375rem 0.625rem",
                      borderRadius: msg.role === "user" ? "0.625rem 0.625rem 0.1875rem 0.625rem" : "0.625rem 0.625rem 0.625rem 0.1875rem",
                      background: msg.role === "user" ? "var(--accent)" : "var(--bg-secondary)",
                      color: msg.role === "user" ? "var(--on-accent)" : "var(--text-primary)",
                      fontSize: "0.78125rem",
                      lineHeight: 1.5,
                      fontFamily: "var(--font-sans), sans-serif",
                    }}
                  >
                    {msg.text}
                  </div>
                </div>
              ))}
            </div>

            {/* Input */}
            <div style={{ padding: "0.75rem 1rem", borderTop: "0.0625rem solid var(--border)", flexShrink: 0 }}>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  send(input);
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", background: "var(--bg-secondary)", border: "0.0625rem solid var(--border)", borderRadius: "0.25rem", padding: "0.5rem 0.75rem" }}>
                  <input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Ask about this map..."
                    style={{ flex: 1, minWidth: 0, height: "1.75rem", background: "none", border: "none", outline: "none", color: "var(--text-primary)", fontSize: "0.8125rem", fontFamily: "var(--font-sans), sans-serif", lineHeight: 1.5, padding: 0 }}
                  />
                  <button
                    type="submit"
                    aria-label="Send message"
                    disabled={!input.trim()}
                    style={{
                      background: "var(--accent)",
                      border: "none",
                      borderRadius: "0.375rem",
                      width: "1.75rem",
                      height: "1.75rem",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: input.trim() ? "pointer" : "default",
                      flexShrink: 0,
                      opacity: input.trim() ? 1 : 0,
                      transition: "opacity 0.15s",
                      pointerEvents: input.trim() ? "auto" : "none",
                    }}
                  >
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="var(--on-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 8H2M8 2l6 6-6 6" />
                    </svg>
                  </button>
                </div>
              </form>
            </div>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Whole-word, case-insensitive match so short names like "RL" or "MAS" don't
// match inside larger words (e.g. "world", "atlas").
function matchesWord(text: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(text);
}

// Canned stand-in for a real model call.
function respond(q: string, graph: DiscoveryGraph): string {
  const topic = graph.topics.find((t) => matchesWord(q, t.short) || matchesWord(q, t.label));
  if (topic) {
    const papers = graph.papers.filter((p) => p.topics.includes(topic.id));
    return `${topic.label} (${topic.short}) covers ${papers.length} papers here: ${papers.map((p) => p.title).join(", ")}.`;
  }
  const lower = q.toLowerCase();
  if (lower.includes("newest") || lower.includes("latest") || lower.includes("recent")) {
    if (graph.papers.length === 0) return "There are no papers in this map yet.";
    const newest = [...graph.papers].sort((a, b) => b.year - a.year)[0];
    return `The most recent is ${newest.title} (${newest.year}) — ${newest.summary ?? ""}`.trim();
  }
  return "Select one or more sub-fields on the map to see the papers they share, or ask about a specific field.";
}
