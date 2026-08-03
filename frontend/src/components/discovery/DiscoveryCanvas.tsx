"use client";

import { useRef, useEffect, useCallback, useMemo, useState } from "react";
import { m, AnimatePresence } from "framer-motion";
import {
  DISCOVERY_GEOMETRY,
  layoutGraph,
  synapsePath,
  type DiscoveryGraph,
} from "@/lib/discovery";
import { DiscoveryPreview, type DiscoveryPreviewData } from "./DiscoveryPreview";

const { rInput: R_INPUT, rTopic: R_TOPIC, rPaper: R_PAPER, headerY: HEADER_Y, columns: COLS } =
  DISCOVERY_GEOMETRY;
const PREVIEW_W = 480;

interface DiscoveryCanvasProps {
  graph: DiscoveryGraph;
  selected: Set<string>;
  onToggleTopic: (id: string) => void;
  onClearSelection: () => void;
}

interface HoverPreview extends DiscoveryPreviewData {
  left: number;
  top: number;
}

export function DiscoveryCanvas({ graph, selected, onToggleTopic, onClearSelection }: DiscoveryCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const nodeLayerRef = useRef<HTMLDivElement>(null);
  const hasCentered = useRef(false);

  const panRef = useRef({ x: 0, y: 0 });
  const zoomRef = useRef(1);
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0 });
  const movedRef = useRef(false);

  const [zoomDisplay, setZoomDisplay] = useState(100);
  const [cursor, setCursor] = useState("grab");
  const [hoverTopic, setHoverTopic] = useState<string | null>(null);
  const [hoverPaper, setHoverPaper] = useState<string | null>(null);
  const [preview, setPreview] = useState<HoverPreview | null>(null);
  const [hoverPreviewEnabled, setHoverPreviewEnabled] = useState(true);
  const hoverHideRef = useRef<number | null>(null);

  // Per-node position overrides (dragging). Keyed by node id; concept = "__concept__".
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const dragRef = useRef<{ id: string; x0: number; y0: number; px: number; py: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);

  const layout = useMemo(() => layoutGraph(graph), [graph]);
  const { world, input, topics, papers, topicById } = layout;

  const applyTransform = useCallback(() => {
    const { x, y } = panRef.current;
    const z = zoomRef.current;
    if (gRef.current) gRef.current.setAttribute("transform", `translate(${x}, ${y}) scale(${z})`);
    if (nodeLayerRef.current) nodeLayerRef.current.style.transform = `translate(${x}px, ${y}px) scale(${z})`;
  }, []);

  // Wheel: ⌘/ctrl zoom to cursor, else pan.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = -Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 10) * 0.01;
        const oldZoom = zoomRef.current;
        const newZoom = Math.min(Math.max(oldZoom + delta, 0.3), 2.5);
        const rect = el.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        panRef.current = {
          x: mx + (panRef.current.x - mx) * (newZoom / oldZoom),
          y: my + (panRef.current.y - my) * (newZoom / oldZoom),
        };
        zoomRef.current = newZoom;
        applyTransform();
        setZoomDisplay(Math.round(newZoom * 100));
      } else {
        panRef.current = { x: panRef.current.x - e.deltaX, y: panRef.current.y - e.deltaY };
        applyTransform();
        setPreview(null);
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [applyTransform]);

  // Drag to pan (skips neuron presses so clicks select).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "touch" || e.button !== 0) return;
      movedRef.current = false;
      // Don't start a pan (which captures the pointer and swallows clicks) when
      // the press lands on a node or any interactive control.
      if (e.target instanceof Element && e.target.closest("[data-neuron], button, a, input")) return;
      isPanningRef.current = true;
      panStartRef.current = { x: e.clientX - panRef.current.x, y: e.clientY - panRef.current.y };
      setCursor("grabbing");
      el.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!isPanningRef.current) return;
      const nx = e.clientX - panStartRef.current.x;
      const ny = e.clientY - panStartRef.current.y;
      if (Math.abs(nx - panRef.current.x) + Math.abs(ny - panRef.current.y) > 2) movedRef.current = true;
      panRef.current = { x: nx, y: ny };
      applyTransform();
    };
    const onUp = () => {
      if (isPanningRef.current) {
        isPanningRef.current = false;
        setCursor("grab");
        // Clear the moved flag after the click that follows this pan fires, so
        // the container onClick still suppresses clearing selection, but later
        // hover previews (which bail while movedRef is set) work again.
        window.setTimeout(() => {
          movedRef.current = false;
        }, 0);
      }
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointerleave", onUp);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointerleave", onUp);
    };
  }, [applyTransform]);

  const fitToView = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const { clientWidth, clientHeight } = el;
    const fit = Math.min(clientWidth / world.w, clientHeight / world.h, 1) * 0.94;
    zoomRef.current = fit;
    panRef.current = { x: (clientWidth - world.w * fit) / 2, y: (clientHeight - world.h * fit) / 2 };
    applyTransform();
    setZoomDisplay(Math.round(fit * 100));
  }, [applyTransform, world.w, world.h]);

  useEffect(() => {
    if (!hasCentered.current) {
      fitToView();
      hasCentered.current = true;
    }
  }, [fitToView]);

  const zoomBy = (factor: number) => {
    const el = containerRef.current;
    if (!el) return;
    const { clientWidth, clientHeight } = el;
    const oldZoom = zoomRef.current;
    const newZoom = Math.min(Math.max(oldZoom * factor, 0.3), 2.5);
    const cx = clientWidth / 2;
    const cy = clientHeight / 2;
    panRef.current = {
      x: cx + (panRef.current.x - cx) * (newZoom / oldZoom),
      y: cy + (panRef.current.y - cy) * (newZoom / oldZoom),
    };
    zoomRef.current = newZoom;
    applyTransform();
    setZoomDisplay(Math.round(newZoom * 100));
  };

  // ── highlight sets: selection = intersection, hover = transient preview ──
  const selectedArr = [...selected];
  const selectedTopicList = topics.filter((t) => selected.has(t.id));
  const sharedCount = selected.size > 0 ? papers.filter((p) => selectedArr.every((t) => p.topics.includes(t))).length : 0;
  const litTopics = new Set<string>();
  const litPapers = new Set<string>();
  selected.forEach((t) => litTopics.add(t));
  if (selected.size > 0) {
    papers
      .filter((p) => selectedArr.every((t) => p.topics.includes(t)))
      .forEach((p) => litPapers.add(p.id));
  }
  if (hoverTopic) {
    litTopics.add(hoverTopic);
    papers.forEach((p) => p.topics.includes(hoverTopic) && litPapers.add(p.id));
  }
  if (hoverPaper) {
    litPapers.add(hoverPaper);
    papers.find((p) => p.id === hoverPaper)?.topics.forEach((t) => litTopics.add(t));
  }
  const isActive = selected.size > 0 || Boolean(hoverTopic || hoverPaper);
  const topicLit = (id: string) => litTopics.has(id);
  const paperLit = (id: string) => litPapers.has(id);
  const synLit = (topicId: string, paperId: string) => litTopics.has(topicId) && litPapers.has(paperId);

  // ── preview positioning ──
  const clearHoverTimeout = () => {
    if (hoverHideRef.current) {
      window.clearTimeout(hoverHideRef.current);
      hoverHideRef.current = null;
    }
  };
  const clearHover = () => {
    clearHoverTimeout();
    setHoverTopic(null);
    setHoverPaper(null);
    setPreview(null);
  };
  // Delay the hide so the cursor can travel from a node onto the preview card.
  const scheduleHide = () => {
    clearHoverTimeout();
    hoverHideRef.current = window.setTimeout(clearHover, 160);
  };
  useEffect(() => () => clearHoverTimeout(), []);

  const placePreview = (rect: DOMRect, data: DiscoveryPreviewData) => {
    if (movedRef.current || !hoverPreviewEnabled) return;
    clearHoverTimeout();
    let left = rect.right + 14;
    if (left + PREVIEW_W > window.innerWidth - 12) left = rect.left - PREVIEW_W - 14;
    const top = Math.max(12, Math.min(rect.top - 6, window.innerHeight - 340));
    setPreview({ ...data, left, top });
  };

  // ── node dragging ──
  const withPos = <T extends { id?: string; x: number; y: number }>(node: T, id: string): T => {
    const p = positions[id];
    return p ? { ...node, x: p.x, y: p.y } : node;
  };
  const inputV = { ...input, ...(positions.__concept__ ?? {}) };
  const topicsV = topics.map((t) => withPos(t, t.id));
  const papersV = papers.map((p) => withPos(p, p.id));
  const topicByIdV: Record<string, (typeof topicsV)[number]> = {};
  topicsV.forEach((t) => (topicByIdV[t.id] = t));

  const startDrag = (id: string, x0: number, y0: number) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    clearHover();
    dragRef.current = { id, x0, y0, px: e.clientX, py: e.clientY, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onDragMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    if (Math.abs(e.clientX - d.px) + Math.abs(e.clientY - d.py) > 3) d.moved = true;
    const z = zoomRef.current;
    setPositions((prev) => ({
      ...prev,
      [d.id]: { x: d.x0 + (e.clientX - d.px) / z, y: d.y0 + (e.clientY - d.py) / z },
    }));
  };
  const onDragEnd = () => {
    if (dragRef.current?.moved) {
      // Swallow the click that follows a drag; a real click resets it first,
      // the timeout clears it when no click fires (e.g. the concept node).
      suppressClickRef.current = true;
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    }
    dragRef.current = null;
  };

  return (
    <m.div
      ref={containerRef}
      className="canvas-grid"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
      onClick={() => {
        if (!movedRef.current) onClearSelection();
      }}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", cursor, touchAction: "none", background: "var(--bg-canvas)" }}
    >
      <svg width="100%" height="100%" style={{ position: "absolute", inset: 0 }}>
        <g ref={gRef}>
          {/* input → topic synapses */}
          {topicsV.map((t) => {
            const lit = topicLit(t.id);
            return (
              <path
                key={`it-${t.id}`}
                d={synapsePath(inputV.x + R_INPUT, inputV.y, t.x - R_TOPIC, t.y)}
                fill="none"
                stroke={lit ? t.color : "var(--edge-color)"}
                strokeWidth={lit ? 2 : 1.25}
                strokeLinecap="round"
                opacity={lit ? 0.9 : isActive ? 0.09 : 0.5}
                style={{ vectorEffect: "non-scaling-stroke", transition: "opacity 0.2s ease, stroke 0.2s ease" } as React.CSSProperties}
              />
            );
          })}

          {/* topic → paper synapses */}
          {papersV.flatMap((p) =>
            p.topics.map((topicId) => {
              const t = topicByIdV[topicId];
              if (!t) return null;
              const lit = synLit(topicId, p.id);
              return (
                <path
                  key={`tp-${topicId}-${p.id}`}
                  d={synapsePath(t.x + R_TOPIC, t.y, p.x - R_PAPER, p.y)}
                  fill="none"
                  stroke={lit ? t.color : "var(--edge-color)"}
                  strokeWidth={lit ? 1.5 : 1}
                  strokeLinecap="round"
                  opacity={lit ? 0.92 : isActive ? 0.06 : 0.32}
                  style={{ vectorEffect: "non-scaling-stroke", transition: "opacity 0.2s ease, stroke 0.2s ease" } as React.CSSProperties}
                />
              );
            }),
          )}
        </g>
      </svg>

      {/* Node + label overlay */}
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
        <div
          ref={nodeLayerRef}
          style={{ position: "absolute", top: 0, left: 0, width: world.w, height: world.h, transformOrigin: "0 0", willChange: "transform" }}
        >
          {/* Layer headers */}
          {[
            { x: COLS.input, label: "CONCEPT" },
            { x: COLS.topic, label: "SUB-FIELDS" },
            { x: COLS.paper, label: "PAPERS" },
          ].map((h) => (
            <div
              key={h.label}
              style={{
                position: "absolute",
                left: h.x,
                top: HEADER_Y,
                transform: "translate(-50%, -50%)",
                color: "var(--text-tertiary)",
                fontFamily: "var(--font-mono), monospace",
                fontSize: "0.6875rem",
                fontWeight: 500,
                letterSpacing: "0.16em",
                whiteSpace: "nowrap",
              }}
            >
              {h.label}
            </div>
          ))}

          {/* Input neuron */}
          <m.div
            data-neuron
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
            onPointerDown={startDrag("__concept__", inputV.x, inputV.y)}
            onPointerMove={onDragMove}
            onPointerUp={onDragEnd}
            style={{
              position: "absolute",
              left: inputV.x - R_INPUT,
              top: inputV.y - R_INPUT,
              width: R_INPUT * 2,
              height: R_INPUT * 2,
              borderRadius: "50%",
              background: "var(--accent)",
              boxShadow: "0 0 0 0.5rem var(--accent-soft), 0 0.375rem 1.25rem var(--accent-glow)",
              cursor: "grab",
              touchAction: "none",
              pointerEvents: "auto",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: inputV.x,
              top: inputV.y + R_INPUT + 14,
              transform: "translateX(-50%)",
              textAlign: "center",
              whiteSpace: "nowrap",
              fontSize: "0.9375rem",
              fontWeight: 600,
              color: "var(--text-primary)",
              letterSpacing: "-0.01em",
            }}
          >
            {inputV.data.label}
          </div>

          {/* Topic neurons */}
          {topicsV.map((t, i) => {
            const lit = topicLit(t.id);
            const isSel = selected.has(t.id);
            const count = papers.filter((p) => p.topics.includes(t.id)).length;
            return (
              <div key={t.id}>
                <m.div
                  data-neuron
                  role="button"
                  tabIndex={0}
                  aria-pressed={isSel}
                  aria-label={`${t.label} sub-field${isSel ? ", selected" : ""}`}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.4, delay: 0.1 + i * 0.04, ease: [0.16, 1, 0.3, 1] }}
                  onPointerDown={startDrag(t.id, t.x, t.y)}
                  onPointerMove={onDragMove}
                  onPointerUp={onDragEnd}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      e.stopPropagation();
                      onToggleTopic(t.id);
                    }
                  }}
                  onMouseEnter={(e) => {
                    if (movedRef.current || dragRef.current) return;
                    clearHoverTimeout();
                    setHoverTopic(t.id);
                    placePreview(e.currentTarget.getBoundingClientRect(), {
                      kind: "topic",
                      pill: "Sub-field",
                      title: t.label,
                      metaLine: [t.short, `${count} ${count === 1 ? "paper" : "papers"}`],
                      summary: t.summary,
                      openLabel: "",
                      bottomLabel: "Papers",
                      bottomItems: papers.filter((p) => p.topics.includes(t.id)).map((p) => p.title),
                      accent: t.color,
                    });
                  }}
                  onMouseLeave={scheduleHide}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (suppressClickRef.current) {
                      suppressClickRef.current = false;
                      return;
                    }
                    onToggleTopic(t.id);
                  }}
                  style={{
                    position: "absolute",
                    left: t.x - R_TOPIC,
                    top: t.y - R_TOPIC,
                    width: R_TOPIC * 2,
                    height: R_TOPIC * 2,
                    borderRadius: "50%",
                    background: isSel ? t.color : "var(--node-bg)",
                    border: `0.1875rem solid ${lit ? t.color : "var(--border-hover)"}`,
                    boxShadow: isSel
                      ? `0 0 0 0.375rem color-mix(in srgb, ${t.color} 22%, transparent)`
                      : lit
                        ? "var(--node-shadow-hover)"
                        : "var(--node-shadow)",
                    opacity: isActive && !lit ? 0.4 : 1,
                    transform: `scale(${isSel ? 1.14 : lit ? 1.06 : 1})`,
                    transition: "opacity 0.2s ease, background 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease",
                    cursor: "grab",
                    touchAction: "none",
                    pointerEvents: "auto",
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    left: t.x + R_TOPIC + 12,
                    top: t.y,
                    transform: "translateY(-50%)",
                    whiteSpace: "nowrap",
                    opacity: isActive && !lit ? 0.4 : 1,
                    transition: "opacity 0.2s ease",
                  }}
                >
                  <div style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-primary)", lineHeight: 1.15 }}>{t.label}</div>
                  <div style={{ fontSize: "0.625rem", fontFamily: "var(--font-mono), monospace", color: "var(--text-tertiary)", letterSpacing: "0.06em" }}>{t.short}</div>
                </div>
              </div>
            );
          })}

          {/* Paper neurons */}
          {papersV.map((p, i) => {
            const lit = paperLit(p.id);
            const parents = p.topics.map((id) => topicByIdV[id]).filter(Boolean);
            const single = parents.length === 1;
            return (
              <div key={p.id}>
                <m.div
                  data-neuron
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.4, delay: 0.22 + i * 0.025, ease: [0.16, 1, 0.3, 1] }}
                  onPointerDown={startDrag(p.id, p.x, p.y)}
                  onPointerMove={onDragMove}
                  onPointerUp={onDragEnd}
                  onMouseEnter={(e) => {
                    if (movedRef.current || dragRef.current) return;
                    clearHoverTimeout();
                    setHoverPaper(p.id);
                    placePreview(e.currentTarget.getBoundingClientRect(), {
                      kind: "paper",
                      pill: "Article Preview",
                      title: p.title,
                      metaLine: [String(p.year), "paper"],
                      authors: p.authors,
                      summary: p.summary,
                      href: `https://scholar.google.com/scholar?q=${encodeURIComponent(p.title)}`,
                      openLabel: "Open article",
                      url: `scholar.google.com/scholar?q=${encodeURIComponent(p.title)}`,
                      bottomLabel: "Topics",
                      bottomItems: parents.map((par) => par.label),
                      accent: "var(--accent)",
                    });
                  }}
                  onMouseLeave={scheduleHide}
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    position: "absolute",
                    left: p.x - R_PAPER,
                    top: p.y - R_PAPER,
                    width: R_PAPER * 2,
                    height: R_PAPER * 2,
                    borderRadius: "50%",
                    background: lit && single ? parents[0].color : "var(--node-bg)",
                    border: `0.125rem solid ${lit ? (single ? parents[0].color : "var(--border-hover)") : "var(--border-hover)"}`,
                    boxShadow: lit ? "var(--node-shadow-hover)" : "var(--node-shadow)",
                    opacity: isActive && !lit ? 0.28 : 1,
                    transform: `scale(${lit && isActive ? 1.22 : 1})`,
                    transition: "opacity 0.2s ease, background 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease",
                    cursor: "grab",
                    touchAction: "none",
                    pointerEvents: "auto",
                  }}
                >
                  {lit && parents.length > 1 && (
                    <div style={{ position: "absolute", inset: "0.0625rem", borderRadius: "50%", overflow: "hidden", display: "flex" }}>
                      {parents.map((par) => (
                        <span key={par.id} style={{ flex: 1, background: par.color }} />
                      ))}
                    </div>
                  )}
                </m.div>
                <div
                  style={{
                    position: "absolute",
                    left: p.x + R_PAPER + 12,
                    top: p.y,
                    transform: "translateY(-50%)",
                    whiteSpace: "nowrap",
                    opacity: isActive && !lit ? 0.28 : 1,
                    transition: "opacity 0.2s ease",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "baseline", gap: "0.375rem" }}>
                    <span style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-primary)", lineHeight: 1.15 }}>{p.title}</span>
                    <span style={{ fontSize: "0.625rem", fontFamily: "var(--font-mono), monospace", color: "var(--accent)" }}>{p.year}</span>
                  </div>
                  <div style={{ fontSize: "0.625rem", fontFamily: "var(--font-mono), monospace", color: "var(--text-tertiary)", letterSpacing: "0.04em" }}>
                    {parents.map((par) => par.short).join(" · ")}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Hover preview */}
      <AnimatePresence>
        {preview && (
          <DiscoveryPreview
            data={preview}
            left={preview.left}
            top={preview.top}
            width={PREVIEW_W}
            onMouseEnter={clearHoverTimeout}
            onMouseLeave={scheduleHide}
          />
        )}
      </AnimatePresence>

      {/* Zoom controls */}
      <div style={{ position: "absolute", bottom: "1rem", left: "1rem", zIndex: 20, display: "flex", gap: "0.25rem", alignItems: "center" }}>
        {[
          { label: "−", title: "Zoom out", action: () => zoomBy(1 / 1.15) },
          { label: "+", title: "Zoom in", action: () => zoomBy(1.15) },
          { label: "⌂", title: "Fit to view", action: fitToView },
        ].map((btn) => (
          <button
            key={btn.title}
            title={btn.title}
            onClick={(e) => {
              e.stopPropagation();
              btn.action();
            }}
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
            }}
          >
            {btn.label}
          </button>
        ))}
        <div
          style={{
            fontSize: "0.6875rem",
            fontFamily: "var(--font-mono), monospace",
            color: "var(--text-tertiary)",
            background: "var(--bg-secondary)",
            border: "0.0625rem solid var(--border)",
            borderRadius: "0.375rem",
            padding: "0.25rem 0.5rem",
            marginLeft: "0.25rem",
            userSelect: "none",
          }}
        >
          {zoomDisplay}%
        </div>

        {/* Hover-preview toggle */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setHoverPreviewEnabled((v) => !v);
            clearHover();
          }}
          title={hoverPreviewEnabled ? "Disable preview" : "Enable preview"}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "1.75rem",
            height: "1.75rem",
            marginLeft: "0.25rem",
            background: hoverPreviewEnabled ? "var(--accent-soft)" : "var(--bg-secondary)",
            border: `0.0625rem solid ${hoverPreviewEnabled ? "var(--accent)" : "var(--border)"}`,
            borderRadius: "0.375rem",
            color: hoverPreviewEnabled ? "var(--accent)" : "var(--text-tertiary)",
            cursor: "pointer",
          }}
        >
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 8s3-5 7-5 7 5 7 5-3 5-7 5-7-5-7-5z" />
            <circle cx="8" cy="8" r="2" />
            {!hoverPreviewEnabled && <path d="M2 2l12 12" />}
          </svg>
        </button>
      </div>

      {/* Bottom-right stack: selection readout above the legend */}
      <div style={{ position: "absolute", bottom: "1rem", right: "1rem", zIndex: 20, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.5rem" }}>
        {selected.size > 0 && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              padding: "0.375rem 0.375rem 0.375rem 0.625rem",
              borderRadius: "0.375rem",
              border: "0.0625rem solid var(--border)",
              background: "color-mix(in srgb, var(--bg-primary) 82%, transparent)",
              backdropFilter: "blur(8px)",
            }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: "0.375rem", fontFamily: "var(--font-mono), monospace", fontSize: "0.75rem", color: "var(--text-secondary)" }}>
              {selectedTopicList.map((t, i) => (
                <span key={t.id} style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
                  {i > 0 && <span style={{ color: "var(--text-tertiary)" }}>∩</span>}
                  <span style={{ width: "0.5rem", height: "0.5rem", borderRadius: "50%", background: t.color }} />
                  {t.short}
                </span>
              ))}
            </span>
            <span style={{ fontFamily: "var(--font-mono), monospace", fontSize: "0.75rem", fontWeight: 500, color: "var(--accent)" }}>
              {sharedCount} {selectedTopicList.length > 1 ? "shared" : sharedCount === 1 ? "paper" : "papers"}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClearSelection();
              }}
              title="Clear selection"
              aria-label="Clear selection"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: "1.5rem",
                height: "1.5rem",
                border: "none",
                borderRadius: "0.375rem",
                background: "transparent",
                color: "var(--text-tertiary)",
                cursor: "pointer",
                fontSize: "0.875rem",
                lineHeight: 1,
              }}
            >
              ×
            </button>
          </div>
        )}

        {/* Legend */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "0.5rem 0.875rem",
            maxWidth: "22rem",
            justifyContent: "flex-end",
            padding: "0.625rem 0.75rem",
            border: "0.0625rem solid var(--border)",
            borderRadius: "0.375rem",
            background: "color-mix(in srgb, var(--bg-primary) 82%, transparent)",
            backdropFilter: "blur(8px)",
          }}
        >
          {topics.map((t) => (
            <div key={t.id} style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
              <span style={{ width: "0.5rem", height: "0.5rem", borderRadius: "50%", background: t.color }} />
              <span style={{ fontSize: "0.6875rem", fontFamily: "var(--font-mono), monospace", color: "var(--text-secondary)", letterSpacing: "0.02em" }}>
                {t.short}
              </span>
            </div>
          ))}
        </div>
      </div>
    </m.div>
  );
}
