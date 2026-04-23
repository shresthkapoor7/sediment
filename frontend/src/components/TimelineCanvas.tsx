"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MarkdownContent } from "./MarkdownContent";
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
  readOnly?: boolean;
}

export function TimelineCanvas({
  data,
  onExpandNode,
  isExpanding,
  readOnly = false,
}: TimelineCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const nodeLayerRef = useRef<HTMLDivElement>(null);
  const hasCentered = useRef(false);

  const panRef = useRef({ x: 0, y: 0 });
  const zoomRef = useRef(1);
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0 });

  // Touch tracking (used by TouchEvent handlers below)
  const lastPinchDistRef = useRef<number | null>(null);
  const touchStartRef = useRef({ x: 0, y: 0 });
  const touchDidMoveRef = useRef(false);
  const touchOnCanvasRef = useRef(false); // true when touch started on SVG, not a UI panel

  const [zoomDisplay, setZoomDisplay] = useState(1);
  const [isOutOfView, setIsOutOfView] = useState(false);
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

  useEffect(() => {
    setHighlightedPaperIds(new Set());
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
    if (nodeLayerRef.current) {
      const { x, y } = panRef.current;
      const z = zoomRef.current;
      nodeLayerRef.current.style.transform = `translate(${x}px, ${y}px) scale(${z})`;
    }
    if (containerRef.current) {
      const { clientWidth, clientHeight } = containerRef.current;
      const { x, y } = panRef.current;
      const z = zoomRef.current;
      const contentRight = x + maxX * z;
      const contentBottom = y + maxY * z;
      const TOLERANCE = 2;
      const outOfView = !(x >= -TOLERANCE && y >= -TOLERANCE && contentRight <= clientWidth + TOLERANCE && contentBottom <= clientHeight + TOLERANCE);
      setIsOutOfView(outOfView);
    }
  }, [maxX, maxY]);

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

  // Mouse/pen panning — middle-click or alt+left-drag
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === "touch") return; // handled by TouchEvent listeners
      if (e.button === 1 || (e.button === 0 && e.altKey)) {
        isPanningRef.current = true;
        panStartRef.current = { x: e.clientX - panRef.current.x, y: e.clientY - panRef.current.y };
        setCursorStyle("grabbing");
        el.setPointerCapture(e.pointerId);
      }
    };
    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      if (!isPanningRef.current) return;
      panRef.current = { x: e.clientX - panStartRef.current.x, y: e.clientY - panStartRef.current.y };
      applyTransform();
    };
    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      if (isPanningRef.current) { isPanningRef.current = false; setCursorStyle("default"); }
    };
    const onPointerLeave = (e: PointerEvent) => {
      if (e.pointerType !== "touch" && isPanningRef.current) { isPanningRef.current = false; setCursorStyle("default"); }
    };

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointerleave", onPointerLeave);
    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointerleave", onPointerLeave);
    };
  }, [applyTransform]);

  // Touch panning + pinch-to-zoom — uses TouchEvent directly for reliable mobile support
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onTouchStart = (e: TouchEvent) => {
      // Treat touches as canvas gestures unless they start inside explicit UI chrome.
      // Nodes render in a plain HTML overlay layer while edges stay in SVG, and
      // touch retargeting can be inconsistent across browsers and between those
      // layers. Checking for explicit UI chrome is more reliable than trying to
      // infer whether the touch started on the "canvas" itself.
      const target = e.target;
      const targetElement =
        target instanceof Element
          ? target
          : target instanceof Node
            ? target.parentElement
            : null;
      touchOnCanvasRef.current = !targetElement?.closest("[data-canvas-ui='true']");
      if (!touchOnCanvasRef.current) return;

      if (e.touches.length === 1) {
        const t = e.touches[0];
        touchStartRef.current = { x: t.clientX, y: t.clientY };
        touchDidMoveRef.current = false;
        isPanningRef.current = false;
        panStartRef.current = { x: t.clientX - panRef.current.x, y: t.clientY - panRef.current.y };
      } else if (e.touches.length === 2) {
        isPanningRef.current = false;
        const t0 = e.touches[0];
        const t1 = e.touches[1];
        const dx = t0.clientX - t1.clientX;
        const dy = t0.clientY - t1.clientY;
        lastPinchDistRef.current = Math.sqrt(dx * dx + dy * dy);
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!touchOnCanvasRef.current) return; // let chat panels / UI scroll normally
      e.preventDefault(); // block browser scroll on the canvas

      if (e.touches.length === 2) {
        const t0 = e.touches[0];
        const t1 = e.touches[1];
        const dx = t0.clientX - t1.clientX;
        const dy = t0.clientY - t1.clientY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (lastPinchDistRef.current !== null && dist > 0) {
          const scale = dist / lastPinchDistRef.current;
          const rect = el.getBoundingClientRect();
          const cx = (t0.clientX + t1.clientX) / 2 - rect.left;
          const cy = (t0.clientY + t1.clientY) / 2 - rect.top;
          const oldZoom = zoomRef.current;
          const newZoom = Math.min(Math.max(oldZoom * scale, 0.3), 2.5);
          panRef.current = {
            x: cx + (panRef.current.x - cx) * (newZoom / oldZoom),
            y: cy + (panRef.current.y - cy) * (newZoom / oldZoom),
          };
          zoomRef.current = newZoom;
          applyTransform();
          setZoomDisplay(Math.round(newZoom * 100));
        }
        lastPinchDistRef.current = dist;
        return;
      }

      if (e.touches.length === 1) {
        const t = e.touches[0];
        if (!touchDidMoveRef.current) {
          const ddx = t.clientX - touchStartRef.current.x;
          const ddy = t.clientY - touchStartRef.current.y;
          if (Math.sqrt(ddx * ddx + ddy * ddy) > 8) {
            touchDidMoveRef.current = true;
            isPanningRef.current = true;
          }
        }
        if (!isPanningRef.current) return;
        panRef.current = { x: t.clientX - panStartRef.current.x, y: t.clientY - panStartRef.current.y };
        applyTransform();
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length === 0) {
        isPanningRef.current = false;
        touchDidMoveRef.current = false;
        lastPinchDistRef.current = null;
        touchOnCanvasRef.current = false;
      } else if (e.touches.length === 1) {
        // 2→1 finger: reset single-finger state without committing a pan
        lastPinchDistRef.current = null;
        isPanningRef.current = false;
        touchDidMoveRef.current = false;
        const t = e.touches[0];
        touchStartRef.current = { x: t.clientX, y: t.clientY };
        panStartRef.current = { x: t.clientX - panRef.current.x, y: t.clientY - panRef.current.y };
      }
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false }); // false so preventDefault works
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [applyTransform]);

  const handleNodeClick = useCallback((id: number) => {
    setActiveNodeId((prev) => (prev === id ? null : id));
    setChatInput("");
    setIsThinking(false);
  }, []);

  // Initial mount: fit-to-view on mobile, 1:1 centered on desktop
  useEffect(() => {
    if (containerRef.current && !hasCentered.current) {
      const { clientWidth, clientHeight } = containerRef.current;
      const isMobile = clientWidth <= 640; // matches globals.css 40rem breakpoint
      const fitZoom = Math.min(clientWidth / maxX, clientHeight / maxY, 1);
      const initialZoom = isMobile ? fitZoom : 1;
      zoomRef.current = initialZoom;
      panRef.current = {
        x: (clientWidth - maxX * initialZoom) / 2,
        y: (clientHeight - maxY * initialZoom) / 2,
      };
      applyTransform();
      setZoomDisplay(Math.round(initialZoom * 100));
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
      const targetNodeId = activeNodeId;
      setChatInput("");
      setIsThinking(true);

      setChatHistories((prev) => ({
        ...prev,
        [targetNodeId]: [...(prev[targetNodeId] ?? []), userMsg],
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
          [targetNodeId]: [...(prev[targetNodeId] ?? []), assistantMsg],
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
            [targetNodeId]: [...(prev[targetNodeId] ?? []), assistantMsg],
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

  const hasExistingExpansion = useCallback(
    (sourceNodeId: number, query: string) =>
      data.expansions.some(
        (expansion) =>
          expansion.sourceNodeId === sourceNodeId &&
          expansion.query.trim().toLowerCase() === query.trim().toLowerCase(),
      ),
    [data.expansions]
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
        borderRadius: "0.75rem",
        position: "relative",
        // touchAction is set on the <svg> only so chat panels inside can still scroll
      }}
    >
      {/* Controls + zoom indicator */}
      <div
        data-canvas-ui="true"
        style={{
          position: "absolute",
          bottom: "1rem",
          left: "1rem",
          display: "flex",
          gap: "0.25rem",
          zIndex: 10,
          alignItems: "center",
        }}
      >
        {[
          {
            label: "\u2212",
            title: "Zoom out",
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
            title: "Zoom in",
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
        ].map((btn) => (
          <button
            key={btn.label}
            onClick={btn.action}
            title={btn.title}
            style={{
              width: "1.75rem",
              height: "1.75rem",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "var(--bg-secondary)",
              border: "0.0625rem solid var(--border)",
              borderRadius: "0.375rem",
              color: "var(--text-secondary)",
              cursor: "pointer",
              fontSize: "0.875rem",
              fontFamily: "inherit",
              transition: "all 0.2s ease",
              touchAction: "manipulation",
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

        {/* Home / fit button — highlights when content is off-screen */}
        <button
          data-canvas-ui="true"
          title="Fit to view"
          onClick={() => {
            if (containerRef.current) {
              const { clientWidth, clientHeight } = containerRef.current;
              const fitZoom = Math.min(clientWidth / maxX, clientHeight / maxY, 1);
              zoomRef.current = fitZoom;
              panRef.current = {
                x: (clientWidth - maxX * fitZoom) / 2,
                y: (clientHeight - maxY * fitZoom) / 2,
              };
              applyTransform();
              setZoomDisplay(Math.round(fitZoom * 100));
            }
          }}
          style={{
            width: "1.75rem",
            height: "1.75rem",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: isOutOfView ? "var(--accent-soft)" : "var(--bg-secondary)",
            border: `0.0625rem solid ${isOutOfView ? "var(--accent)" : "var(--border)"}`,
            borderRadius: "0.375rem",
            color: isOutOfView ? "var(--accent)" : "var(--text-secondary)",
            cursor: "pointer",
            fontSize: "0.875rem",
            fontFamily: "inherit",
            transition: "all 0.2s ease",
            boxShadow: isOutOfView ? "0 0 0 0.1875rem var(--accent-soft)" : "none",
            touchAction: "manipulation",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "var(--accent)";
            e.currentTarget.style.color = "var(--accent)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = isOutOfView ? "var(--accent)" : "var(--border)";
            e.currentTarget.style.color = isOutOfView ? "var(--accent)" : "var(--text-secondary)";
          }}
        >
          ⌂
        </button>
        <div style={{
          fontSize: "0.6875rem",
          fontFamily: "'JetBrains Mono', monospace",
          color: "var(--text-tertiary)",
          background: "var(--bg-secondary)",
          border: "0.0625rem solid var(--border)",
          borderRadius: "0.375rem",
          padding: "0.25rem 0.5rem",
          userSelect: "none",
          letterSpacing: "0.02em",
          marginLeft: "0.25rem",
        }}>
          {zoomDisplay}%
        </div>
      </div>

      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        style={{ position: "absolute", top: 0, left: 0, touchAction: "none" }}
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

        </g>
      </svg>

      <div
        style={{
          position: "absolute",
          inset: 0,
          overflow: "hidden",
          touchAction: "none",
        }}
      >
        <div
          ref={nodeLayerRef}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: maxX,
            height: maxY,
            transformOrigin: "0 0",
            willChange: "transform",
          }}
        >
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
        </div>
      </div>

      {/* Side panel backdrop */}
      <AnimatePresence>
        {activeNodeId && activeNode && (
          <motion.div
            data-canvas-ui="true"
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
            data-canvas-ui="true"
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
              width: "min(23.75rem, 100%)",
              background: "var(--bg-primary)",
              borderLeft: "0.0625rem solid var(--border)",
              zIndex: 20,
              display: "flex",
              flexDirection: "column",
              boxShadow: "-0.5rem 0 2rem rgba(0,0,0,0.08)",
            }}
          >
            {/* Toolbar */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                padding: "0.625rem 1rem",
                borderBottom: "0.0625rem solid var(--border)",
                flexShrink: 0,
                minHeight: "3.25rem",
              }}
            >
              <button
                onClick={() => setActiveNodeId(null)}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: "1.75rem", height: "1.75rem", background: "none", border: "none",
                  borderRadius: "0.375rem", color: "var(--text-tertiary)", cursor: "pointer",
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
                  fontSize: "0.6875rem",
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
                  fontSize: "0.8125rem",
                  color: "var(--text-primary)",
                  fontFamily: "'DM Sans', sans-serif",
                  fontWeight: 500,
                  lineHeight: 1.35,
                }}
                title={activeNode.paper.title}
              >
                {activeNode.paper.title}
              </div>
              {(activeNode.paper.oaUrl || activeNode.paper.doi || activeNode.paper.arxivId) && (
                <a
                  href={activeNode.paper.oaUrl || (activeNode.paper.arxivId ? `https://arxiv.org/abs/${activeNode.paper.arxivId}` : activeNode.paper.doi!) }
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    flexShrink: 0, fontSize: "0.6875rem", color: "var(--text-tertiary)", textDecoration: "none",
                    fontFamily: "'JetBrains Mono', monospace", background: "var(--bg-secondary)",
                    border: "0.0625rem solid var(--border)", borderRadius: "0.3125rem", padding: "0.1875rem 0.4375rem", transition: "all 0.15s",
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.borderColor = "var(--accent)"; (e.currentTarget as HTMLAnchorElement).style.color = "var(--accent)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.borderColor = "var(--border)"; (e.currentTarget as HTMLAnchorElement).style.color = "var(--text-tertiary)"; }}
                >
                  Open ↗
                </a>
              )}
            </div>

            {/* Scrollable chat area */}
            <div
              style={{
                flex: 1,
                overflowY: "auto",
                padding: "1.25rem 1.25rem 0.5rem",
                touchAction: "pan-y",
              }}
            >

              {/* Paper context — shown as a subtle block at the top */}
              <div
                style={{
                  background: "var(--bg-secondary)",
                  borderRadius: "0.625rem",
                  padding: "0.875rem 1rem",
                  marginBottom: "1.25rem",
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.625rem",
                }}
              >
                {/* Type badge */}
                {activeNode.paper.type && (
                  <span style={{
                    alignSelf: "flex-start",
                    fontSize: "0.625rem",
                    fontFamily: "'JetBrains Mono', monospace",
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    color: "var(--accent)",
                    background: "var(--accent-soft)",
                    border: "0.0625rem solid var(--accent)",
                    borderRadius: "0.25rem",
                    padding: "0.125rem 0.375rem",
                  }}>
                    {activeNode.paper.type.replace(/-/g, " ")}
                  </span>
                )}

                {/* AI Summary */}
                <div>
                  <p style={{ fontSize: "0.625rem", color: "var(--text-tertiary)", fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: "0.3125rem" }}>
                    AI Summary
                  </p>
                  <MarkdownContent style={{ fontSize: "0.8125rem", color: "var(--text-primary)", lineHeight: 1.6, fontFamily: "'DM Sans', sans-serif", fontStyle: "italic", overflowWrap: "break-word" }}>
                    {activeNode.paper.summary}
                  </MarkdownContent>
                </div>

                {/* Abstract */}
                {activeNode.paper.detail && (
                  <div>
                    <p style={{ fontSize: "0.625rem", color: "var(--text-tertiary)", fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: "0.3125rem" }}>
                      Abstract
                    </p>
                    <MarkdownContent style={{ fontSize: "0.78125rem", color: "var(--text-secondary)", lineHeight: 1.7, fontFamily: "'DM Sans', sans-serif", overflowWrap: "break-word" }}>
                      {activeNode.paper.detail}
                    </MarkdownContent>
                  </div>
                )}

                {/* Concepts */}
                {activeNode.paper.concepts && activeNode.paper.concepts.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3125rem" }}>
                    {activeNode.paper.concepts.map((c) => (
                      <span key={c} style={{
                        fontSize: "0.625rem",
                        fontFamily: "'DM Sans', sans-serif",
                        color: "var(--text-tertiary)",
                        background: "var(--bg-primary)",
                        border: "0.0625rem solid var(--border)",
                        borderRadius: "0.25rem",
                        padding: "0.125rem 0.375rem",
                      }}>
                        {c}
                      </span>
                    ))}
                  </div>
                )}

                {/* Authors */}
                {activeNode.paper.authors && activeNode.paper.authors.length > 0 && (
                  <p style={{ fontSize: "0.6875rem", color: "var(--text-tertiary)", fontFamily: "'DM Sans', sans-serif" }}>
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
                  style={{ marginBottom: "1rem" }}
                >
                  {msg.role === "user" ? (
                    <div style={{ display: "flex", justifyContent: "flex-end" }}>
                      <div
                        style={{
                          background: "var(--accent-soft)",
                          border: "0.0625rem solid var(--accent)",
                          borderRadius: "0.75rem 0.75rem 0.125rem 0.75rem",
                          padding: "0.5625rem 0.8125rem",
                          maxWidth: "80%",
                          fontSize: "0.8125rem",
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
                      <MarkdownContent style={{ fontSize: "0.84375rem", color: "var(--text-primary)", lineHeight: 1.7, fontFamily: "'DM Sans', sans-serif", marginBottom: msg.suggestion ? "0.875rem" : 0 }}>
                        {msg.content}
                      </MarkdownContent>

                      {/* Lineage suggestion card */}
                      {msg.suggestion && (
                        <motion.div
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.15, duration: 0.3 }}
                          style={{
                            background: "var(--bg-secondary)",
                            border: "0.0625rem solid var(--border)",
                            borderRadius: "0.625rem",
                            padding: "0.75rem 0.875rem",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: "0.625rem",
                          }}
                        >
                          {(() => {
                            const suggestionAlreadyAdded = hasExistingExpansion(
                              activeNode.id,
                              msg.suggestion.query,
                            );

                            return (
                              <>
                          <div>
                            <p style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-primary)", fontFamily: "'DM Sans', sans-serif", marginBottom: "0.125rem" }}>
                              {msg.suggestion.topic}
                            </p>
                            <p style={{ fontSize: "0.6875rem", color: "var(--text-tertiary)", fontFamily: "'JetBrains Mono', monospace" }}>
                              {msg.suggestion.nodeCount} papers · trace lineage?
                            </p>
                          </div>
                          <motion.button
                            onClick={() => !readOnly && !suggestionAlreadyAdded && !isExpanding && handleAddLineage(msg.suggestion!.query)}
                            disabled={readOnly || suggestionAlreadyAdded || isExpanding}
                            whileHover={!readOnly && !suggestionAlreadyAdded && !isExpanding ? { scale: 1.03 } : {}}
                            whileTap={!readOnly && !suggestionAlreadyAdded && !isExpanding ? { scale: 0.97 } : {}}
                            style={{
                              flexShrink: 0,
                              background: suggestionAlreadyAdded ? "var(--bg-tertiary)" : "var(--accent)",
                              color: suggestionAlreadyAdded ? "var(--text-tertiary)" : "white",
                              border: "none",
                              borderRadius: "0.4375rem",
                              padding: "0.4375rem 0.8125rem",
                              fontSize: "0.75rem",
                              fontWeight: 500,
                              cursor: readOnly || suggestionAlreadyAdded ? "default" : "pointer",
                              pointerEvents: readOnly ? "none" : "auto",
                              fontFamily: "'DM Sans', sans-serif",
                              display: "flex",
                              alignItems: "center",
                              gap: "0.3125rem",
                              opacity: suggestionAlreadyAdded ? 0.5 : 1,
                              transition: "background 0.15s, opacity 0.15s",
                            }}
                          >
                            {isExpanding ? (
                              <motion.div
                                animate={{ rotate: 360 }}
                                transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                                style={{ width: "0.75rem", height: "0.75rem", border: "0.09375rem solid rgba(255,255,255,0.3)", borderTopColor: "white", borderRadius: "50%" }}
                              />
                            ) : suggestionAlreadyAdded ? (
                              "Added ✓"
                            ) : (
                              <>Add to timeline →</>
                            )}
                          </motion.button>
                              </>
                            );
                          })()}
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
                    style={{ display: "flex", gap: "0.25rem", alignItems: "center", paddingBottom: "0.75rem" }}
                  >
                    {[0, 1, 2].map((i) => (
                      <motion.div
                        key={i}
                        animate={{ opacity: [0.3, 1, 0.3] }}
                        transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
                        style={{ width: "0.375rem", height: "0.375rem", borderRadius: "0.1875rem", background: "var(--text-tertiary)" }}
                      />
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>

              <div ref={chatEndRef} />
            </div>

            {/* Input bar */}
            {!readOnly && <div style={{ padding: "0.75rem 1rem", borderTop: "0.0625rem solid var(--border)", flexShrink: 0 }}>
              <form onSubmit={handleChatSubmit}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    background: "var(--bg-secondary)",
                    border: "0.0625rem solid var(--border)",
                    borderRadius: "0.625rem",
                    padding: "0.5625rem 0.75rem",
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
                      fontSize: "0.8125rem",
                      fontFamily: "'DM Sans', sans-serif",
                    }}
                  />
                  <button
                    type="submit"
                    disabled={isThinking || !chatInput.trim()}
                    style={{
                      background: "var(--accent)",
                      border: "none",
                      borderRadius: "0.375rem",
                      width: "1.75rem",
                      height: "1.75rem",
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
            </div>}
          </motion.div>
        )}
      </AnimatePresence>

      {!activeNodeId && !readOnly && (
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
