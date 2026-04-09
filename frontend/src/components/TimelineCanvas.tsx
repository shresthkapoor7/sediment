"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { chatAboutPaper } from "@/lib/api";
import { TimelineData, ChatSuggestion } from "@/lib/types";
import { NODE_DIMENSIONS } from "@/lib/dummy-data";
import { TimelineNodeCard } from "./TimelineNode";
import { TimelineEdgeLine } from "./TimelineEdge";
import { GlobalChatPanel } from "./GlobalChatPanel";

interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  suggestion?: ChatSuggestion | null;
}

interface TimelineCanvasProps {
  data: TimelineData;
  onExpandNode: (nodeId: number, query: string) => void;
  isExpanding: boolean;
}

export function TimelineCanvas({
  data,
  onExpandNode,
  isExpanding,
}: TimelineCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const hasCentered = useRef(false);

  const panRef = useRef({ x: 0, y: 0 });
  const zoomRef = useRef(1);
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0 });

  const [zoomDisplay, setZoomDisplay] = useState(1);
  const [cursorStyle, setCursorStyle] = useState("default");
  const [activeNodeId, setActiveNodeId] = useState<number | null>(null);
  const [chatHistories, setChatHistories] = useState<Record<number, ChatMessage[]>>({});
  const [chatInput, setChatInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const msgIdRef = useRef(0);
  const [highlightedPaperIds, setHighlightedPaperIds] = useState<Set<string>>(new Set());

  // Track the latest generation so only new nodes animate
  const latestGenRef = useRef(0);
  const [latestGeneration, setLatestGeneration] = useState(0);

  // Update latest generation when data changes
  useEffect(() => {
    let maxGen = 0;
    for (const n of Object.values(data.nodes)) {
      if (n.generation > maxGen) maxGen = n.generation;
    }
    if (maxGen > latestGenRef.current) {
      latestGenRef.current = maxGen;
      setLatestGeneration(maxGen);
    }
  }, [data]);

  const allNodes = Object.values(data.nodes);
  const maxX =
    allNodes.length === 0
      ? NODE_DIMENSIONS.width + 120
      : Math.max(...allNodes.map((n) => n.x + NODE_DIMENSIONS.width)) + 120;
  const maxY =
    allNodes.length === 0
      ? NODE_DIMENSIONS.height + 120
      : Math.max(...allNodes.map((n) => n.y + NODE_DIMENSIONS.height)) + 120;

  const applyTransform = useCallback(() => {
    if (gRef.current) {
      const { x, y } = panRef.current;
      const z = zoomRef.current;
      gRef.current.setAttribute(
        "transform",
        `translate(${x}, ${y}) scale(${z})`
      );
    }
  }, []);

  // Wheel: zoom (pinch / ctrl+scroll) or pan (plain scroll)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      if (isPanningRef.current) return;

      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const sign = Math.sign(e.deltaY);
        const abs = Math.min(Math.abs(e.deltaY), 10);
        const delta = -sign * abs * 0.01;
        const oldZoom = zoomRef.current;
        const newZoom = Math.min(Math.max(oldZoom + delta, 0.3), 2.5);

        // Cursor position relative to the container
        const rect = el.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        // Adjust pan so the canvas point under the cursor stays fixed:
        // newPan = mouse + (pan - mouse) * (newZoom / oldZoom)
        panRef.current = {
          x: mouseX + (panRef.current.x - mouseX) * (newZoom / oldZoom),
          y: mouseY + (panRef.current.y - mouseY) * (newZoom / oldZoom),
        };

        zoomRef.current = newZoom;
        applyTransform();
        setZoomDisplay(Math.round(newZoom * 100));
      } else {
        panRef.current = {
          x: panRef.current.x - e.deltaX,
          y: panRef.current.y - e.deltaY,
        };
        applyTransform();
      }
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [applyTransform]);

  // Pointer-based panning
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onPointerDown = (e: PointerEvent) => {
      if (e.button === 1 || (e.button === 0 && e.altKey)) {
        isPanningRef.current = true;
        panStartRef.current = {
          x: e.clientX - panRef.current.x,
          y: e.clientY - panRef.current.y,
        };
        setCursorStyle("grabbing");
        el.setPointerCapture(e.pointerId);
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!isPanningRef.current) return;
      panRef.current = {
        x: e.clientX - panStartRef.current.x,
        y: e.clientY - panStartRef.current.y,
      };
      applyTransform();
    };

    const onPointerUp = () => {
      if (isPanningRef.current) {
        isPanningRef.current = false;
        setCursorStyle("default");
      }
    };

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointerleave", onPointerUp);
    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointerleave", onPointerUp);
    };
  }, [applyTransform]);

  const handleNodeClick = useCallback((id: number) => {
    setActiveNodeId((prev) => (prev === id ? null : id));
    setChatInput("");
    setIsThinking(false);
  }, []);

  // Center on initial mount only
  useEffect(() => {
    if (containerRef.current && !hasCentered.current) {
      const { clientWidth, clientHeight } = containerRef.current;
      panRef.current = {
        x: (clientWidth - maxX) / 2,
        y: (clientHeight - maxY) / 2,
      };
      applyTransform();
      hasCentered.current = true;
    }
  }, [applyTransform, maxX, maxY]);

  const nodeArray = Object.values(data.nodes);

  // Derive edges from adjacency list (single source of truth)
  const edgesForRender = Object.entries(data.adjacency).flatMap(
    ([fromIdStr, children]) => {
      const fromId = Number(fromIdStr);
      return children.map((toId) => ({ from: fromId, to: toId }));
    }
  );

  const activeRelated = new Set<number>();
  if (activeNodeId) {
    activeRelated.add(activeNodeId);
    const node = data.nodes[activeNodeId];
    if (node?.parentId !== null && node?.parentId !== undefined) activeRelated.add(node.parentId);
    // children are in adjacency
    (data.adjacency[activeNodeId] ?? []).forEach((c) => activeRelated.add(c));
  }

  const activeNode = activeNodeId ? data.nodes[activeNodeId] : null;

  // Auto-scroll chat to bottom when messages change
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistories, isThinking]);

  const handleChatSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!activeNodeId || !activeNode || !chatInput.trim() || isThinking) return;

      const userMsg: ChatMessage = {
        id: ++msgIdRef.current,
        role: "user",
        content: chatInput.trim(),
      };
      const query = chatInput.trim();
      const currentNode = activeNode;
      setChatInput("");
      setIsThinking(true);

      setChatHistories((prev) => ({
        ...prev,
        [activeNodeId]: [...(prev[activeNodeId] ?? []), userMsg],
      }));

      void chatAboutPaper(currentNode, query)
        .then((response) => {
        const assistantMsg: ChatMessage = {
          id: ++msgIdRef.current,
          role: "assistant",
          content: response.text,
          suggestion: response.suggestion,
        };
        setChatHistories((prev) => ({
          ...prev,
          [activeNodeId]: [...(prev[activeNodeId] ?? []), assistantMsg],
        }));
        })
        .catch((error) => {
          const assistantMsg: ChatMessage = {
            id: ++msgIdRef.current,
            role: "assistant",
            content: error instanceof Error ? error.message : "Chat failed",
          };
          setChatHistories((prev) => ({
            ...prev,
            [activeNodeId]: [...(prev[activeNodeId] ?? []), assistantMsg],
          }));
        })
        .finally(() => {
        setIsThinking(false);
        });
    },
    [activeNode, activeNodeId, chatInput, isThinking]
  );

  const handleAddLineage = useCallback(
    (query: string) => {
      if (!activeNodeId) return;
      onExpandNode(activeNodeId, query);
    },
    [activeNodeId, onExpandNode]
  );

  return (
    <motion.div
      ref={containerRef}
      className="canvas-grid"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
      style={{
        width: "100%",
        height: "100%",
        overflow: "hidden",
        cursor: cursorStyle,
        background: "var(--bg-canvas)",
        borderRadius: 12,
        position: "relative",
        touchAction: "none",
      }}
    >
      {/* Controls + zoom indicator */}
      <div
        style={{
          position: "absolute",
          bottom: 16,
          left: 16,
          display: "flex",
          gap: 4,
          zIndex: 10,
          alignItems: "center",
        }}
      >
        {[
          {
            label: "\u2212",
            action: () => {
              if (!containerRef.current) return;
              const { clientWidth, clientHeight } = containerRef.current;
              const oldZoom = zoomRef.current;
              const newZoom = Math.max(oldZoom - 0.15, 0.3);
              const cx = clientWidth / 2;
              const cy = clientHeight / 2;
              panRef.current = {
                x: cx + (panRef.current.x - cx) * (newZoom / oldZoom),
                y: cy + (panRef.current.y - cy) * (newZoom / oldZoom),
              };
              zoomRef.current = newZoom;
              applyTransform();
              setZoomDisplay(Math.round(newZoom * 100));
            },
          },
          {
            label: "+",
            action: () => {
              if (!containerRef.current) return;
              const { clientWidth, clientHeight } = containerRef.current;
              const oldZoom = zoomRef.current;
              const newZoom = Math.min(oldZoom + 0.15, 2.5);
              const cx = clientWidth / 2;
              const cy = clientHeight / 2;
              panRef.current = {
                x: cx + (panRef.current.x - cx) * (newZoom / oldZoom),
                y: cy + (panRef.current.y - cy) * (newZoom / oldZoom),
              };
              zoomRef.current = newZoom;
              applyTransform();
              setZoomDisplay(Math.round(newZoom * 100));
            },
          },
          {
            label: "\u2302",
            action: () => {
              if (containerRef.current) {
                const { clientWidth, clientHeight } = containerRef.current;
                zoomRef.current = 1;
                panRef.current = {
                  x: (clientWidth - maxX) / 2,
                  y: (clientHeight - maxY) / 2,
                };
                applyTransform();
                setZoomDisplay(100);
              }
            },
          },
        ].map((btn) => (
          <button
            key={btn.label}
            onClick={btn.action}
            style={{
              width: 28,
              height: 28,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "var(--bg-secondary)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              color: "var(--text-secondary)",
              cursor: "pointer",
              fontSize: 14,
              fontFamily: "inherit",
              transition: "all 0.2s ease",
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
            {btn.label}
          </button>
        ))}
        <div style={{
          fontSize: 11,
          fontFamily: "'JetBrains Mono', monospace",
          color: "var(--text-tertiary)",
          background: "var(--bg-secondary)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          padding: "4px 8px",
          userSelect: "none",
          letterSpacing: "0.02em",
          marginLeft: 4,
        }}>
          {zoomDisplay}%
        </div>
      </div>

      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        style={{ position: "absolute", top: 0, left: 0 }}
      >
        <defs>
          <marker id="arrow-default" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L0,6 L8,3 z" fill="var(--edge-color)" opacity="0.7" />
          </marker>
          <marker id="arrow-active" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L0,6 L8,3 z" fill="var(--edge-color-active)" />
          </marker>
          <marker id="arrow-cross" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L0,6 L8,3 z" fill="var(--edge-color)" opacity="0.5" />
          </marker>
        </defs>
        <g ref={gRef}>
          {/* Edges — derived from adjacency list */}
          {edgesForRender.map((edge, i) => {
            const from = data.nodes[edge.from];
            const to = data.nodes[edge.to];
            if (!from || !to) return null;
            const isActive =
              activeRelated.has(edge.from) && activeRelated.has(edge.to);
            const isCrossLane = from.lane !== to.lane;
            return (
              <TimelineEdgeLine
                key={`${edge.from}-${edge.to}-${i}`}
                from={from}
                to={to}
                index={i}
                isActive={isActive}
                isCrossLane={isCrossLane}
              />
            );
          })}

          {/* Nodes */}
          {nodeArray.map((node, i) => (
            <TimelineNodeCard
              key={node.id}
              node={node}
              index={i}
              onClick={handleNodeClick}
              isActive={activeRelated.has(node.id)}
              isHighlighted={highlightedPaperIds.has(node.paper.openalexId)}
              shouldAnimate={node.generation === latestGeneration}
            />
          ))}
        </g>
      </svg>

      {/* Side panel backdrop */}
      <AnimatePresence>
        {activeNodeId && activeNode && (
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setActiveNodeId(null)}
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 19,
              background: "transparent",
            }}
          />
        )}
      </AnimatePresence>

      {/* Conversational side panel */}
      <AnimatePresence>
        {activeNodeId && activeNode && (
          <motion.div
            key={activeNodeId}
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            onWheelCapture={(e) => e.stopPropagation()}
            style={{
              position: "absolute",
              top: 0,
              right: 0,
              bottom: 0,
              width: 380,
              background: "var(--bg-primary)",
              borderLeft: "1px solid var(--border)",
              zIndex: 20,
              display: "flex",
              flexDirection: "column",
              boxShadow: "-8px 0 32px rgba(0,0,0,0.08)",
            }}
          >
            {/* Toolbar */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 16px",
                borderBottom: "1px solid var(--border)",
                flexShrink: 0,
                minHeight: 52,
              }}
            >
              <button
                onClick={() => setActiveNodeId(null)}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 28, height: 28, background: "none", border: "none",
                  borderRadius: 6, color: "var(--text-tertiary)", cursor: "pointer",
                  transition: "background 0.15s, color 0.15s",
                  flexShrink: 0,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-secondary)"; e.currentTarget.style.color = "var(--text-primary)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "var(--text-tertiary)"; }}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 4l4 4-4 4" />
                </svg>
              </button>
              <span
                style={{
                  fontSize: 11,
                  color: "var(--text-tertiary)",
                  fontFamily: "'JetBrains Mono', monospace",
                  letterSpacing: "0.04em",
                  flexShrink: 0,
                }}
              >
                {activeNode.paper.year}
              </span>
              <div
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontSize: 13,
                  color: "var(--text-primary)",
                  fontFamily: "'DM Sans', sans-serif",
                  fontWeight: 500,
                  lineHeight: 1.35,
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                  wordBreak: "break-word",
                }}
                title={activeNode.paper.title}
              >
                {activeNode.paper.title}
              </div>
              {(activeNode.paper.doi || activeNode.paper.arxivId) && (
                <a
                  href={activeNode.paper.doi ? activeNode.paper.doi : `https://arxiv.org/abs/${activeNode.paper.arxivId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    flexShrink: 0, fontSize: 11, color: "var(--text-tertiary)", textDecoration: "none",
                    fontFamily: "'JetBrains Mono', monospace", background: "var(--bg-secondary)",
                    border: "1px solid var(--border)", borderRadius: 5, padding: "3px 7px", transition: "all 0.15s",
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.borderColor = "var(--accent)"; (e.currentTarget as HTMLAnchorElement).style.color = "var(--accent)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.borderColor = "var(--border)"; (e.currentTarget as HTMLAnchorElement).style.color = "var(--text-tertiary)"; }}
                >
                  Open ↗
                </a>
              )}
            </div>

            {/* Scrollable chat area */}
            <div style={{ flex: 1, overflowY: "auto", padding: "20px 20px 8px" }}>

              {/* Paper context — shown as a subtle block at the top */}
              <div
                style={{
                  background: "var(--bg-secondary)",
                  borderRadius: 10,
                  padding: "14px 16px",
                  marginBottom: 20,
                  borderLeft: "3px solid var(--border)",
                }}
              >
                <p style={{ fontSize: 13, color: "var(--text-primary)", lineHeight: 1.6, fontFamily: "'DM Sans', sans-serif", fontStyle: "italic", marginBottom: activeNode.paper.detail ? 10 : 0 }}>
                  {activeNode.paper.summary}
                </p>
                {activeNode.paper.detail && (
                  <p style={{ fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.7, fontFamily: "'DM Sans', sans-serif" }}>
                    {activeNode.paper.detail}
                  </p>
                )}
                {activeNode.paper.authors && activeNode.paper.authors.length > 0 && (
                  <p style={{ fontSize: 11, color: "var(--text-tertiary)", fontFamily: "'DM Sans', sans-serif", marginTop: 10 }}>
                    {activeNode.paper.authors.join(", ")}
                  </p>
                )}
              </div>

              {/* Chat messages */}
              {(chatHistories[activeNodeId] ?? []).map((msg) => (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                  style={{ marginBottom: 16 }}
                >
                  {msg.role === "user" ? (
                    <div style={{ display: "flex", justifyContent: "flex-end" }}>
                      <div
                        style={{
                          background: "var(--accent-soft)",
                          border: "1px solid var(--accent)",
                          borderRadius: "12px 12px 2px 12px",
                          padding: "9px 13px",
                          maxWidth: "80%",
                          fontSize: 13,
                          color: "var(--text-primary)",
                          fontFamily: "'DM Sans', sans-serif",
                          lineHeight: 1.5,
                        }}
                      >
                        {msg.content}
                      </div>
                    </div>
                  ) : (
                    <div>
                      <p
                        style={{
                          fontSize: 13.5,
                          color: "var(--text-primary)",
                          lineHeight: 1.7,
                          fontFamily: "'DM Sans', sans-serif",
                          marginBottom: msg.suggestion ? 14 : 0,
                        }}
                      >
                        {msg.content}
                      </p>

                      {/* Lineage suggestion card */}
                      {msg.suggestion && (
                        <motion.div
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.15, duration: 0.3 }}
                          style={{
                            background: "var(--bg-secondary)",
                            border: "1px solid var(--border)",
                            borderRadius: 10,
                            padding: "12px 14px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 10,
                          }}
                        >
                          <div>
                            <p style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)", fontFamily: "'DM Sans', sans-serif", marginBottom: 2 }}>
                              {msg.suggestion.topic}
                            </p>
                            <p style={{ fontSize: 11, color: "var(--text-tertiary)", fontFamily: "'JetBrains Mono', monospace" }}>
                              {msg.suggestion.nodeCount} papers · trace lineage?
                            </p>
                          </div>
                          <motion.button
                            onClick={() => !activeNode.expanded && !isExpanding && handleAddLineage(msg.suggestion!.query)}
                            disabled={activeNode.expanded || isExpanding}
                            whileHover={!activeNode.expanded && !isExpanding ? { scale: 1.03 } : {}}
                            whileTap={!activeNode.expanded && !isExpanding ? { scale: 0.97 } : {}}
                            style={{
                              flexShrink: 0,
                              background: activeNode.expanded ? "var(--bg-tertiary)" : "var(--accent)",
                              color: activeNode.expanded ? "var(--text-tertiary)" : "white",
                              border: "none",
                              borderRadius: 7,
                              padding: "7px 13px",
                              fontSize: 12,
                              fontWeight: 500,
                              cursor: activeNode.expanded ? "default" : "pointer",
                              fontFamily: "'DM Sans', sans-serif",
                              display: "flex",
                              alignItems: "center",
                              gap: 5,
                              opacity: activeNode.expanded ? 0.5 : 1,
                              transition: "background 0.15s, opacity 0.15s",
                            }}
                          >
                            {isExpanding ? (
                              <motion.div
                                animate={{ rotate: 360 }}
                                transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                                style={{ width: 12, height: 12, border: "1.5px solid rgba(255,255,255,0.3)", borderTopColor: "white", borderRadius: "50%" }}
                              />
                            ) : activeNode.expanded ? (
                              "Added ✓"
                            ) : (
                              <>Add to timeline →</>
                            )}
                          </motion.button>
                        </motion.div>
                      )}
                    </div>
                  )}
                </motion.div>
              ))}

              {/* Thinking indicator */}
              <AnimatePresence>
                {isThinking && (
                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    style={{ display: "flex", gap: 4, alignItems: "center", paddingBottom: 12 }}
                  >
                    {[0, 1, 2].map((i) => (
                      <motion.div
                        key={i}
                        animate={{ opacity: [0.3, 1, 0.3] }}
                        transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
                        style={{ width: 6, height: 6, borderRadius: 3, background: "var(--text-tertiary)" }}
                      />
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>

              <div ref={chatEndRef} />
            </div>

            {/* Input bar */}
            <div style={{ padding: "12px 16px", borderTop: "1px solid var(--border)", flexShrink: 0 }}>
              <form onSubmit={handleChatSubmit}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    background: "var(--bg-secondary)",
                    border: "1px solid var(--border)",
                    borderRadius: 10,
                    padding: "9px 12px",
                    transition: "border-color 0.15s",
                  }}
                >
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Ask about this paper..."
                    disabled={isThinking}
                    style={{
                      flex: 1,
                      background: "none",
                      border: "none",
                      outline: "none",
                      color: "var(--text-primary)",
                      fontSize: 13,
                      fontFamily: "'DM Sans', sans-serif",
                    }}
                  />
                  <button
                    type="submit"
                    disabled={isThinking || !chatInput.trim()}
                    style={{
                      background: "var(--accent)",
                      border: "none",
                      borderRadius: 6,
                      width: 28,
                      height: 28,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: chatInput.trim() ? "pointer" : "default",
                      flexShrink: 0,
                      opacity: chatInput.trim() ? 1 : 0,
                      transition: "opacity 0.15s",
                      pointerEvents: chatInput.trim() ? "auto" : "none",
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

      {!activeNodeId && (
        <GlobalChatPanel
          data={data}
          onHighlight={(ids) => setHighlightedPaperIds(new Set(ids))}
          onAddLineage={(query) => onExpandNode(data.rootId, query)}
          isExpanding={isExpanding}
        />
      )}
    </motion.div>
  );
}
