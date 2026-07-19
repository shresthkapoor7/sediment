"use client";

import Link from "next/link";
import { useState, useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ClarificationModal } from "@/components/ClarificationModal";
import { SearchInput } from "@/components/SearchInput";
import { ThemeToggle } from "@/components/ThemeToggle";
import { TimelineCanvas } from "@/components/TimelineCanvas";
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

const THUMB_SIZE = 13;

function SettingsSlider({
  item,
  value,
  onChange,
}: {
  item: { key: string; label: string; min: number; max: number };
  value: number;
  onChange: (v: number) => void;
}) {
  const pct = ((value - item.min) / (item.max - item.min)) * 100;
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          fontSize: "0.71875rem",
          color: "var(--text-secondary)",
          fontFamily: "'DM Sans', sans-serif",
        }}
      >
        <span style={{ fontWeight: 500 }}>{item.label}</span>
        <span
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: "0.6875rem",
            color: "var(--accent)",
          }}
        >
          {value}
        </span>
      </div>
      <div
        style={{
          position: "relative",
          height: "1.25rem",
          display: "flex",
          alignItems: "center",
        }}
      >
        {/* Track */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            height: "0.1875rem",
            top: "50%",
            transform: "translateY(-50%)",
            borderRadius: "0.125rem",
            background: "var(--bg-tertiary)",
          }}
        />
        {/* Fill */}
        <div
          style={{
            position: "absolute",
            left: 0,
            height: "0.1875rem",
            top: "50%",
            transform: "translateY(-50%)",
            borderRadius: "0.125rem",
            background: "var(--accent)",
            width: `${pct}%`,
          }}
        />
        {/* Thumb */}
        <div
          style={{
            position: "absolute",
            width: THUMB_SIZE,
            height: THUMB_SIZE,
            top: "50%",
            transform: "translateY(-50%)",
            borderRadius: "50%",
            background: "var(--accent)",
            boxShadow: "0 0.0625rem 0.25rem rgba(0,0,0,0.3)",
            pointerEvents: "none",
            left: `calc(${pct}% - ${(pct / 100) * THUMB_SIZE}px)`,
          }}
        />
        {/* Hidden native input */}
        <input
          type="range"
          min={item.min}
          max={item.max}
          value={value}
          onChange={(e) => onChange(Number(e.currentTarget.value))}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            margin: 0,
            opacity: 0,
            cursor: "pointer",
            height: "100%",
          }}
        />
      </div>
    </label>
  );
}

const DEFAULT_SETTINGS: TraversalSettings = {
  depth: 1,
  breadth: 2,
  referenceLimit: 20,
  topN: 5,
};
const DELETE_CONFIRMATION_DISABLED_KEY = "history_delete_confirmation_disabled";
const HISTORY_PAGE_SIZE = 10;

type DemoPaper = {
  id: string;
  year: number;
  title: string;
  summary: string;
  authors: string;
};

type DemoEdge = [string, string];

type DemoPositionMap = Record<string, { x: number; y: number }>;

const DEMO_PAPERS: DemoPaper[] = [
  {
    id: "p1",
    year: 1958,
    title: "The Perceptron",
    summary: "Rosenblatt's first learning machine for binary classification.",
    authors: "Frank Rosenblatt",
  },
  {
    id: "p2",
    year: 1986,
    title: "Learning representations by back-propagating errors",
    summary: "Backpropagation made multilayer neural networks trainable.",
    authors: "Rumelhart, Hinton, Williams",
  },
  {
    id: "p3",
    year: 1997,
    title: "Long Short-Term Memory",
    summary: "LSTMs addressed vanishing gradients in sequential learning.",
    authors: "Hochreiter, Schmidhuber",
  },
  {
    id: "p4",
    year: 2003,
    title: "A Neural Probabilistic Language Model",
    summary:
      "Neural language models began learning distributed word representations.",
    authors: "Bengio, Ducharme, Vincent, Jauvin",
  },
  {
    id: "p5",
    year: 2014,
    title:
      "Neural Machine Translation by Jointly Learning to Align and Translate",
    summary: "Attention emerged as a soft alignment mechanism for translation.",
    authors: "Bahdanau, Cho, Bengio",
  },
  {
    id: "p6",
    year: 2017,
    title: "Attention Is All You Need",
    summary:
      "The Transformer removed recurrence and relied entirely on attention.",
    authors: "Vaswani et al.",
  },
];

const DEMO_EDGES: DemoEdge[] = [
  ["p1", "p6"],
  ["p2", "p6"],
  ["p3", "p6"],
  ["p4", "p6"],
  ["p5", "p6"],
];

const DEMO_SCENE_POSITIONS: DemoPositionMap = {
  p1: { x: 10, y: 54 },
  p2: { x: 24, y: 76 },
  p3: { x: 38, y: 90 },
  p4: { x: 42, y: 18 },
  p5: { x: 58, y: 36 },
  p6: { x: 84, y: 38 },
};

const DEMO_FINAL_POSITIONS: DemoPositionMap = {
  p1: { x: 10, y: 52 },
  p2: { x: 24, y: 74 },
  p3: { x: 38, y: 88 },
  p4: { x: 42, y: 16 },
  p5: { x: 58, y: 34 },
  p6: { x: 84, y: 30 },
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));
const lerp = (start: number, end: number, progress: number) =>
  start + (end - start) * progress;
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t: number) =>
  t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
const stepProgress = (
  progress: number,
  stepIndex: number,
  totalSteps: number,
) => {
  const size = 1 / totalSteps;
  return clamp((progress - stepIndex * size) / size, 0, 1);
};

function useSectionProgress(
  sectionRef: React.RefObject<HTMLElement | null>,
  containerRef: React.RefObject<HTMLElement | null>,
) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let raf = 0;
    let last = -1;

    const tick = () => {
      const section = sectionRef.current;
      const container = containerRef.current;

      if (section && container) {
        const sectionRect = section.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        const total = sectionRect.height - container.clientHeight;
        const scrolled = containerRect.top - sectionRect.top;
        const next =
          total <= 0 ? (scrolled > 0 ? 1 : 0) : clamp(scrolled / total, 0, 1);

        if (Math.abs(next - last) > 0.002) {
          last = next;
          setProgress(next);
        }
      }

      raf = window.requestAnimationFrame(tick);
    };

    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [containerRef, sectionRef]);

  return progress;
}

function useLandingViewport() {
  const [viewport, setViewport] = useState({ compact: false, mobile: false });

  useEffect(() => {
    const updateViewport = () => {
      const width = window.innerWidth;
      setViewport({
        compact: width <= 1024,
        mobile: width <= 640,
      });
    };

    updateViewport();
    window.addEventListener("resize", updateViewport);
    return () => window.removeEventListener("resize", updateViewport);
  }, []);

  return viewport;
}

function DemoPaperCard({
  paper,
  position,
  width,
  opacity,
  scale,
  active,
  seed,
  dim,
  onMouseEnter,
  onMouseLeave,
  staticCard,
}: {
  paper: DemoPaper;
  position: { x: number; y: number };
  width: number;
  opacity: number;
  scale: number;
  active?: boolean;
  seed?: boolean;
  dim?: boolean;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  staticCard?: boolean;
}) {
  return (
    <div
      style={{
        position: staticCard ? "relative" : "absolute",
        background: "var(--node-bg)",
        border: `0.0625rem solid ${active ? "var(--accent)" : "var(--node-border)"}`,
        borderRadius: "0.625rem",
        padding: "0.6875rem 0.8125rem 0.75rem",
        boxShadow: active
          ? "0 0 0 0.0625rem var(--accent), 0 0 1.875rem -0.25rem var(--accent-glow), var(--node-shadow)"
          : "var(--node-shadow)",
        transition:
          "opacity 0.25s ease, transform 0.25s ease, filter 0.25s ease, border-color 0.25s ease, box-shadow 0.25s ease",
        width: `${width}px`,
        left: staticCard ? undefined : `calc(${position.x}% - ${width / 2}px)`,
        top: staticCard ? undefined : `${position.y}%`,
        opacity,
        transform: `scale(${scale})`,
        filter: dim ? "saturate(0.6) brightness(0.9)" : undefined,
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {seed && (
        <div
          style={{
            position: "absolute",
            top: "-0.5rem",
            right: "0.625rem",
            background: "var(--accent)",
            color: "var(--bg-primary)",
            borderRadius: "0.25rem",
            padding: "0.1875rem 0.375rem",
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: "0.5625rem",
            letterSpacing: "0.1em",
          }}
        >
          SEED
        </div>
      )}
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          padding: "0.25rem 0.375rem",
          borderRadius: "0.25rem",
          background: "var(--accent-soft)",
          color: "var(--accent)",
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: "0.625rem",
          letterSpacing: "0.04em",
          marginBottom: "0.5rem",
        }}
      >
        {paper.year}
      </div>
      <div
        style={{
          fontSize: "0.78125rem",
          fontWeight: 600,
          color: "var(--text-primary)",
          lineHeight: 1.35,
          marginBottom: "0.375rem",
        }}
      >
        {paper.title}
      </div>
      <div
        style={{
          fontSize: "0.6875rem",
          lineHeight: 1.45,
          color: "var(--text-secondary)",
        }}
      >
        {paper.summary}
      </div>
    </div>
  );
}

function buildBezierPath(x1: number, y1: number, x2: number, y2: number) {
  const dx = Math.max(110, Math.abs(x2 - x1) * 0.42);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

function DemoGraph({
  positions,
  reveal,
  edgeProgress,
  cardWidth,
  hoverId,
  seedId,
  onHover,
  onLeave,
  viewBoxWidth = 1000,
}: {
  positions: DemoPositionMap;
  reveal: number;
  edgeProgress: number;
  cardWidth: number;
  hoverId?: string | null;
  seedId?: string | null;
  onHover?: (id: string) => void;
  onLeave?: () => void;
  viewBoxWidth?: number;
}) {
  const cardHeight = 82;
  const viewBox = viewBoxWidth;
  const finalNodeId = "p6";

  return (
    <div className="demo-graph">
      <svg
        className="demo-graph-edges"
        viewBox={`0 0 ${viewBox} ${viewBox}`}
        preserveAspectRatio="none"
      >
        {DEMO_EDGES.map(([from, to], index) => {
          const fromPos = positions[from];
          const toPos = positions[to];
          if (!fromPos || !toPos) return null;

          const x1 = (fromPos.x / 100) * viewBox + cardWidth / 2;
          const y1 = (fromPos.y / 100) * viewBox + cardHeight / 2;
          const x2 = (toPos.x / 100) * viewBox - cardWidth / 2;
          const y2 = (toPos.y / 100) * viewBox + cardHeight / 2;
          const localProgress = clamp(
            (edgeProgress - index / DEMO_EDGES.length) * DEMO_EDGES.length,
            0,
            1,
          );
          const isHighlighted = hoverId === from || hoverId === to;
          const length = 2000;

          return (
            <path
              key={`${from}-${to}`}
              d={buildBezierPath(x1, y1, x2, y2)}
              className={`demo-graph-edge${isHighlighted ? " is-highlighted" : ""}`}
              pathLength={1}
              strokeDasharray={length}
              strokeDashoffset={length * (1 - localProgress)}
            />
          );
        })}
      </svg>

      {DEMO_PAPERS.map((paper, index) => {
        const position = positions[paper.id];
        if (!position) return null;
        const cardProgress = clamp(
          (reveal * DEMO_PAPERS.length - index) * 1.35,
          0,
          1,
        );
        const isDimmed = Boolean(hoverId && hoverId !== paper.id);
        const isTerminal = paper.id === finalNodeId;

        return (
          <DemoPaperCard
            key={paper.id}
            paper={paper}
            position={position}
            width={cardWidth}
            opacity={cardProgress}
            scale={lerp(
              isTerminal ? 0.96 : 0.9,
              isTerminal ? 1.04 : 1,
              cardProgress,
            )}
            active={hoverId === paper.id}
            seed={seedId === paper.id}
            dim={isDimmed}
            onMouseEnter={onHover ? () => onHover(paper.id) : undefined}
            onMouseLeave={onLeave}
          />
        );
      })}
    </div>
  );
}

function buildMobileEllipsePath(
  width: number,
  top: number,
  height: number,
  scaleX: number,
  rotationDegrees: number,
  reverse = false,
) {
  const centerX = width / 2;
  const centerY = top + height / 2;
  const radiusX = width / 2;
  const radiusY = height / 2;
  const rotation = (rotationDegrees * Math.PI) / 180;
  const steps = 180;
  const points = Array.from({ length: steps + 1 }, (_, index) => {
    const progress = index / steps;
    const angle = (reverse ? -progress : progress) * Math.PI * 2;
    const x = radiusX * Math.cos(angle) * scaleX;
    const y = radiusY * Math.sin(angle);
    return [
      centerX + Math.cos(rotation) * x - Math.sin(rotation) * y,
      centerY + Math.sin(rotation) * x + Math.cos(rotation) * y,
    ];
  });

  return points
    .map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`)
    .join(" ");
}

function MobileLandingHelixParticles() {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [frame, setFrame] = useState({ width: 1, height: 1, paths: ["", ""] });

  useEffect(() => {
    const svg = svgRef.current;
    const strata = svg?.parentElement;
    if (!svg || !strata) return;

    const updatePaths = () => {
      const ellipseElements = Array.from(strata.querySelectorAll(":scope > span"));
      const width = strata.clientWidth;
      const height = strata.clientHeight;
      if (!width || !height || ellipseElements.length < 3) return;

      const primary = ellipseElements[0];
      const secondary = ellipseElements[2];
      setFrame({
        width,
        height,
        paths: [
          buildMobileEllipsePath(width, primary.offsetTop, primary.offsetHeight, 0.84, -5),
          buildMobileEllipsePath(width, secondary.offsetTop, secondary.offsetHeight, 0.76, -3, true),
        ],
      });
    };

    updatePaths();
    const observer = new ResizeObserver(updatePaths);
    observer.observe(strata);
    return () => observer.disconnect();
  }, []);

  return (
    <svg
      ref={svgRef}
      className="landing-helix-particles landing-helix-particles-mobile"
      viewBox={`0 0 ${frame.width} ${frame.height}`}
      preserveAspectRatio="none"
    >
      {frame.paths.map((path, index) => path && (
        <g
          key={index}
          className={`landing-helix-particle${index === 1 ? " landing-helix-particle-secondary" : ""}`}
        >
          <animateMotion
            dur="26s"
            begin={index === 1 ? "-13s" : undefined}
            repeatCount="indefinite"
            path={path}
          />
          <animate
            attributeName="opacity"
            values={index === 1 ? "0;0.7;0.7;0" : "0;0.9;0.9;0"}
            keyTimes="0;0.035;0.96;1"
            dur="26s"
            begin={index === 1 ? "-13s" : undefined}
            repeatCount="indefinite"
          />
          <circle className="landing-helix-core" r="4.25" />
        </g>
      ))}
    </svg>
  );
}

function LandingScrollHint({
  containerRef,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let raf = 0;

    const tick = () => {
      const container = containerRef.current;
      if (container) {
        setHidden(container.scrollTop > 48);
      }
      raf = window.requestAnimationFrame(tick);
    };

    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [containerRef]);

  return (
    <div
      aria-hidden
      className={`landing-scroll-hint${hidden ? " is-hidden" : ""}`}
    >
      <span className="landing-scroll-lines">
        {["5rem", "3.5rem", "2.25rem"].map((width, index) => (
          <span
            key={width}
            style={{ width, animationDelay: `${index * 0.28}s` }}
          />
        ))}
      </span>
    </div>
  );
}

function DemoTypeScene({
  containerRef,
  compact,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  compact: boolean;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  const progress = useSectionProgress(sectionRef, containerRef);
  const phrase = "Attention is all you need";
  const typeProgress = stepProgress(progress, 0, 3);
  const resolveProgress = stepProgress(progress, 1, 3);
  const settleProgress = stepProgress(progress, 2, 3);
  const typedLength = Math.floor(typeProgress * phrase.length);

  return (
    <section
      ref={sectionRef}
      style={{
        minHeight: compact ? "auto" : "200vh",
        padding: compact ? "0 1rem 2rem" : "0 2rem",
      }}
    >
      <div
        style={{
          position: compact ? "relative" : "sticky",
          top: 0,
          minHeight: compact ? "auto" : "100vh",
          display: "grid",
          gridTemplateColumns: compact ? "1fr" : "5fr 7fr",
          gap: compact ? "1.5rem" : "3rem",
          alignItems: "center",
          maxWidth: "82.5rem",
          margin: "0 auto",
          padding: compact ? "2rem 0" : "3.75rem 0",
        }}
      >
        <div
          style={{
            maxWidth: "28.75rem",
            display: "flex",
            flexDirection: "column",
            gap: "1.25rem",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.625rem",
              color: "var(--text-tertiary)",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "0.6875rem",
              letterSpacing: "0.16em",
              textTransform: "uppercase",
            }}
          >
            <span style={{ color: "var(--accent)" }}>01</span>
            <div
              style={{
                width: "3.75rem",
                height: "0.0625rem",
                background: "var(--border)",
              }}
            />
            <span>Begin</span>
          </div>
          <h2
            style={{
              fontFamily: "'Instrument Serif', Georgia, serif",
              fontWeight: 400,
              fontSize: compact ? "2.5rem" : "clamp(2.5rem, 5vw, 4rem)",
              lineHeight: 1.02,
              letterSpacing: "-0.02em",
              color: "var(--text-primary)",
            }}
          >
            Begin with
            <br />
            <em style={{ fontStyle: "italic", color: "var(--text-secondary)" }}>
              a thought.
            </em>
          </h2>
          <p
            style={{
              color: "var(--text-secondary)",
              fontSize: "1.0625rem",
              lineHeight: 1.6,
            }}
          >
            Type a concept, a paper title, or a half-remembered idea. Sediment
            resolves it into a seed paper that anchors the lineage you can trace
            backward.
          </p>
        </div>

        <div
          style={{
            position: "relative",
            height: compact ? "26rem" : "min(38.75rem, 78vh)",
            overflow: "hidden",
            border: "0.0625rem solid var(--border)",
            borderRadius: "0.875rem",
            background:
              "linear-gradient(180deg, var(--bg-secondary) 0%, var(--bg-primary) 100%)",
            boxShadow:
              "0 1.875rem 5rem -2.5rem rgba(0, 0, 0, 0.22), inset 0 0.0625rem 0 rgba(255,255,255,0.06)",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              backgroundImage:
                "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.06) 1px, transparent 0)",
              backgroundSize: "1.5rem 1.5rem",
              pointerEvents: "none",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: "8%",
              right: "8%",
              top: "18%",
              display: "flex",
              alignItems: "center",
              gap: "0.625rem",
              padding: "0.875rem 1rem",
              background:
                "color-mix(in srgb, var(--bg-primary) 72%, transparent)",
              border: "0.0625rem solid var(--border-hover)",
              borderRadius: "0.75rem",
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--text-tertiary)"
              strokeWidth="1.8"
              strokeLinecap="round"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
            <div
              style={{
                flex: 1,
                minHeight: "1rem",
                display: "flex",
                alignItems: "center",
                color: "var(--text-primary)",
                fontSize: "0.9375rem",
              }}
            >
              {typedLength > 0 ? (
                phrase.slice(0, typedLength)
              ) : (
                <span style={{ color: "var(--text-tertiary)" }}>
                  Trace a concept...
                </span>
              )}
              {typeProgress < 1 && (
                <span
                  style={{
                    width: "0.0625rem",
                    height: "0.875rem",
                    marginLeft: "0.125rem",
                    background: "var(--accent)",
                    animation: "demo-blink 1s steps(1) infinite",
                  }}
                />
              )}
            </div>
            <div
              style={{
                width: "1.75rem",
                height: "1.75rem",
                borderRadius: "0.5rem",
                border: `0.0625rem solid ${typeProgress > 0.95 ? "var(--accent)" : "var(--border-hover)"}`,
                display: "grid",
                placeItems: "center",
                color:
                  typeProgress > 0.95
                    ? "#fff"
                    : "var(--text-tertiary)",
                background:
                  typeProgress > 0.95 ? "var(--accent)" : "var(--bg-secondary)",
              }}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 13 13 3" />
                <path d="M5 3h8v8" />
              </svg>
            </div>
          </div>

          {typeProgress > 0.95 && resolveProgress < 0.3 && (
            <div
              style={{
                position: "absolute",
                top: "38%",
                left: "50%",
                transform: "translateX(-50%)",
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: "0.65625rem",
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "var(--text-tertiary)",
              }}
            >
              <span
                style={{
                  width: "0.375rem",
                  height: "0.375rem",
                  borderRadius: "50%",
                  background: "var(--accent)",
                  animation: "demo-blink 0.7s infinite",
                }}
              />
              tracing through OpenAlex
            </div>
          )}

          {resolveProgress > 0.05 && (
            <div
              style={{
                position: "absolute",
                left: "50%",
                top: "55%",
                opacity: clamp(resolveProgress * 1.2, 0, 1),
                transform: `translate(-50%, ${lerp(20, 0, easeOut(resolveProgress))}px)`,
              }}
            >
              <DemoPaperCard
                paper={DEMO_PAPERS[5]}
                position={{ x: 50, y: 0 }}
                width={228}
                opacity={1}
                scale={1}
                seed
                staticCard
              />
              {settleProgress > 0.3 && (
                <div
                  style={{
                    marginTop: "1rem",
                    textAlign: "center",
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: "0.65625rem",
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                    color: "var(--text-tertiary)",
                  }}
                >
                  now trace back the ancestry
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function DemoLineageScene({
  containerRef,
  compact,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  compact: boolean;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  const progress = useSectionProgress(sectionRef, containerRef);
  const reveal = clamp(progress / 0.85, 0, 1);
  const edgeProgress = clamp((reveal - 0.05) / 0.9, 0, 1);

  return (
    <section
      ref={sectionRef}
      style={{
        minHeight: compact ? "auto" : "200vh",
        padding: compact ? "0 1rem 2rem" : "0 2rem",
      }}
    >
      <div
        style={{
          position: compact ? "relative" : "sticky",
          top: 0,
          minHeight: compact ? "auto" : "100vh",
          display: "grid",
          gridTemplateColumns: compact ? "1fr" : "7fr 5fr",
          gap: compact ? "1.5rem" : "3rem",
          alignItems: "center",
          maxWidth: "82.5rem",
          margin: "0 auto",
          padding: compact ? "2rem 0" : "3.75rem 0",
        }}
      >
        <div
          style={{
            maxWidth: "28.75rem",
            display: "flex",
            flexDirection: "column",
            gap: "1.25rem",
            order: compact ? 0 : 2,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.625rem",
              color: "var(--text-tertiary)",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "0.6875rem",
              letterSpacing: "0.16em",
              textTransform: "uppercase",
            }}
          >
            <span style={{ color: "var(--accent)" }}>02</span>
            <div
              style={{
                width: "3.75rem",
                height: "0.0625rem",
                background: "var(--border)",
              }}
            />
            <span>Unfold</span>
          </div>
          <h2
            style={{
              fontFamily: "'Instrument Serif', Georgia, serif",
              fontWeight: 400,
              fontSize: compact ? "2.5rem" : "clamp(2.5rem, 5vw, 4rem)",
              lineHeight: 1.02,
              letterSpacing: "-0.02em",
              color: "var(--text-primary)",
            }}
          >
            Lineage
            <br />
            <em style={{ fontStyle: "italic", color: "var(--text-secondary)" }}>
              unfolds.
            </em>
          </h2>
          <p
            style={{
              color: "var(--text-secondary)",
              fontSize: "1.0625rem",
              lineHeight: 1.6,
            }}
          >
            The graph composes itself chronologically, oldest to newest.
            Branches split where ideas diverge and converge again where new
            synthesis happens.
          </p>
          <div
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "0.6875rem",
              letterSpacing: "0.06em",
              color: "var(--text-tertiary)",
            }}
          >
            5 precursor papers converging into 1 transformer node
          </div>
        </div>

        <div
          style={{
            order: compact ? 0 : 1,
            position: "relative",
            height: compact ? "26rem" : "min(38.75rem, 78vh)",
            overflow: "hidden",
            border: "0.0625rem solid var(--border)",
            borderRadius: "0.875rem",
            background:
              "linear-gradient(180deg, var(--bg-secondary) 0%, var(--bg-primary) 100%)",
            boxShadow:
              "0 1.875rem 5rem -2.5rem rgba(0, 0, 0, 0.22), inset 0 0.0625rem 0 rgba(255,255,255,0.06)",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              backgroundImage:
                "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.06) 1px, transparent 0)",
              backgroundSize: "1.5rem 1.5rem",
              pointerEvents: "none",
            }}
          />
          <DemoGraph
            positions={DEMO_SCENE_POSITIONS}
            reveal={reveal}
            edgeProgress={edgeProgress}
            cardWidth={140}
            viewBoxWidth={1120}
          />
        </div>
      </div>
    </section>
  );
}

function DemoDetailScene({
  containerRef,
  compact,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  compact: boolean;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  const progress = useSectionProgress(sectionRef, containerRef);
  const hoverPhase = stepProgress(progress, 1, 3);
  const detailPhase = stepProgress(progress, 2, 3);
  const hoverId = hoverPhase > 0.2 || detailPhase > 0 ? "p6" : null;

  return (
    <section
      ref={sectionRef}
      style={{
        minHeight: compact ? "auto" : "200vh",
        padding: compact ? "0 1rem 2rem" : "0 2rem",
      }}
    >
      <div
        style={{
          position: compact ? "relative" : "sticky",
          top: 0,
          minHeight: compact ? "auto" : "100vh",
          display: "grid",
          gridTemplateColumns: compact ? "1fr" : "5fr 7fr",
          gap: compact ? "1.5rem" : "3rem",
          alignItems: "center",
          maxWidth: "82.5rem",
          margin: "0 auto",
          padding: compact ? "2rem 0" : "3.75rem 0",
        }}
      >
        <div
          style={{
            maxWidth: "28.75rem",
            display: "flex",
            flexDirection: "column",
            gap: "1.25rem",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.625rem",
              color: "var(--text-tertiary)",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "0.6875rem",
              letterSpacing: "0.16em",
              textTransform: "uppercase",
            }}
          >
            <span style={{ color: "var(--accent)" }}>03</span>
            <div
              style={{
                width: "3.75rem",
                height: "0.0625rem",
                background: "var(--border)",
              }}
            />
            <span>Read</span>
          </div>
          <h2
            style={{
              fontFamily: "'Instrument Serif', Georgia, serif",
              fontWeight: 400,
              fontSize: compact ? "2.5rem" : "clamp(2.5rem, 5vw, 4rem)",
              lineHeight: 1.02,
              letterSpacing: "-0.02em",
              color: "var(--text-primary)",
            }}
          >
            Lean in
            <br />
            <em style={{ fontStyle: "italic", color: "var(--text-secondary)" }}>
              for context.
            </em>
          </h2>
          <p
            style={{
              color: "var(--text-secondary)",
              fontSize: "1.0625rem",
              lineHeight: 1.6,
            }}
          >
            Hover any paper and the context panel opens with title, authors,
            impact, and the lineage relationships that explain why that node
            matters.
          </p>
        </div>

        <div
          style={{
            position: "relative",
            height: compact ? "26rem" : "min(38.75rem, 78vh)",
            overflow: "hidden",
            border: "0.0625rem solid var(--border)",
            borderRadius: "0.875rem",
            background:
              "linear-gradient(180deg, var(--bg-secondary) 0%, var(--bg-primary) 100%)",
            boxShadow:
              "0 1.875rem 5rem -2.5rem rgba(0, 0, 0, 0.22), inset 0 0.0625rem 0 rgba(255,255,255,0.06)",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              backgroundImage:
                "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.06) 1px, transparent 0)",
              backgroundSize: "1.5rem 1.5rem",
              pointerEvents: "none",
            }}
          />
          <DemoGraph
            positions={DEMO_SCENE_POSITIONS}
            reveal={1}
            edgeProgress={1}
            cardWidth={140}
            hoverId={hoverId}
            viewBoxWidth={1120}
          />

          <div
            style={{
              position: "absolute",
              pointerEvents: "none",
              left: `${DEMO_SCENE_POSITIONS.p6.x}%`,
              top: `${DEMO_SCENE_POSITIONS.p6.y + 6}%`,
              transform: `translate(${lerp(-180, -28, easeInOut(hoverPhase))}px, ${lerp(80, 8, easeInOut(hoverPhase))}px)`,
              opacity: hoverPhase > 0.05 || detailPhase > 0 ? 1 : 0,
            }}
          >
            <svg width="24" height="26" viewBox="0 0 24 26">
              <path
                d="M3 2 L3 20 L8 16 L11 22 L14 21 L11 15 L18 14 Z"
                fill="white"
                stroke="black"
                strokeWidth="1"
              />
            </svg>
          </div>

          <div
            style={{
              position: "absolute",
              top: 0,
              right: 0,
              bottom: 0,
              width: compact ? "100%" : "56%",
              padding: compact ? "1rem" : "1.75rem 1.5rem",
              background: "var(--bg-secondary)",
              borderLeft: "0.0625rem solid var(--border)",
              transform:
                hoverPhase > 0.35 ? "translateX(0)" : "translateX(100%)",
              transition: "transform 0.5s cubic-bezier(.22, .61, .36, 1)",
            }}
          >
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "0.25rem 0.375rem",
                borderRadius: "0.25rem",
                background: "var(--accent-soft)",
                color: "var(--accent)",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: "0.625rem",
                letterSpacing: "0.04em",
                marginBottom: "0.5rem",
              }}
            >
              2017 · NeurIPS
            </div>
            <h4
              style={{
                fontFamily: "'Instrument Serif', Georgia, serif",
                fontSize: "1.375rem",
                fontWeight: 400,
                lineHeight: 1.2,
                color: "var(--text-primary)",
                marginBottom: "0.375rem",
              }}
            >
              Attention Is All You Need
            </h4>
            <div
              style={{
                fontSize: "0.75rem",
                lineHeight: 1.45,
                color: "var(--text-secondary)",
                marginBottom: "1.125rem",
              }}
            >
              {DEMO_PAPERS[5].authors}
            </div>
            <div
              style={{
                display: "flex",
                gap: "0.75rem",
                paddingBottom: "1rem",
                marginBottom: "1rem",
                borderBottom: "0.0625rem solid var(--border)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.1875rem",
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: "0.6875rem",
                  color: "var(--text-secondary)",
                }}
              >
                <strong
                  style={{
                    fontSize: "0.875rem",
                    fontWeight: 500,
                    color: "var(--text-primary)",
                  }}
                >
                  104k+
                </strong>
                <span>citations</span>
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.1875rem",
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: "0.6875rem",
                  color: "var(--text-secondary)",
                }}
              >
                <strong
                  style={{
                    fontSize: "0.875rem",
                    fontWeight: 500,
                    color: "var(--text-primary)",
                  }}
                >
                  5
                </strong>
                <span>precursors</span>
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.1875rem",
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: "0.6875rem",
                  color: "var(--text-secondary)",
                }}
              >
                <strong
                  style={{
                    fontSize: "0.875rem",
                    fontWeight: 500,
                    color: "var(--text-primary)",
                  }}
                >
                  2
                </strong>
                <span>lanes</span>
              </div>
            </div>
            <p
              style={{
                fontSize: "0.8125rem",
                lineHeight: 1.6,
                color: "var(--text-secondary)",
              }}
            >
              The Transformer replaced recurrence with attention, making
              sequence modeling far more parallelizable while inheriting its
              conceptual strata from backprop, LSTMs, and early attention-based
              translation work.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function DemoChatScene({
  containerRef,
  compact,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  compact: boolean;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  const progress = useSectionProgress(sectionRef, containerRef);
  const messages = [
    { role: "user", text: "Why did attention replace recurrence here?" },
    {
      role: "ai",
      text: "Recurrence forces sequential computation. Attention exposes the whole sequence at once, which made large-scale training tractable.",
      cite: "Vaswani 2017",
    },
    { role: "user", text: "What is the throughline from 1986 to here?" },
    {
      role: "ai",
      text: "Backprop made deep nets trainable. LSTMs made them sequence-aware. Attention detached them from step-by-step order.",
      cite: "Rumelhart 1986",
    },
  ];

  return (
    <section
      ref={sectionRef}
      style={{
        minHeight: compact ? "auto" : "200vh",
        padding: compact ? "0 1rem 2rem" : "0 2rem",
      }}
    >
      <div
        style={{
          position: compact ? "relative" : "sticky",
          top: 0,
          minHeight: compact ? "auto" : "100vh",
          display: "grid",
          gridTemplateColumns: compact ? "1fr" : "7fr 5fr",
          gap: compact ? "1.5rem" : "3rem",
          alignItems: "center",
          maxWidth: "82.5rem",
          margin: "0 auto",
          padding: compact ? "2rem 0" : "3.75rem 0",
        }}
      >
        <div
          style={{
            maxWidth: "28.75rem",
            display: "flex",
            flexDirection: "column",
            gap: "1.25rem",
            order: compact ? 0 : 2,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.625rem",
              color: "var(--text-tertiary)",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "0.6875rem",
              letterSpacing: "0.16em",
              textTransform: "uppercase",
            }}
          >
            <span style={{ color: "var(--accent)" }}>04</span>
            <div
              style={{
                width: "3.75rem",
                height: "0.0625rem",
                background: "var(--border)",
              }}
            />
            <span>Converse</span>
          </div>
          <h2
            style={{
              fontFamily: "'Instrument Serif', Georgia, serif",
              fontWeight: 400,
              fontSize: compact ? "2.5rem" : "clamp(2.5rem, 5vw, 4rem)",
              lineHeight: 1.02,
              letterSpacing: "-0.02em",
              color: "var(--text-primary)",
            }}
          >
            Converse with
            <br />
            <em style={{ fontStyle: "italic", color: "var(--text-secondary)" }}>
              the strata.
            </em>
          </h2>
          <p
            style={{
              color: "var(--text-secondary)",
              fontSize: "1.0625rem",
              lineHeight: 1.6,
            }}
          >
            Ask questions about a paper or the full graph. The assistant stays
            grounded in the nodes in front of you and points back to the papers
            it used.
          </p>
        </div>

        <div
          style={{
            order: compact ? 0 : 1,
            position: "relative",
            height: compact ? "26rem" : "min(38.75rem, 78vh)",
            overflow: "hidden",
            border: "0.0625rem solid var(--border)",
            borderRadius: "0.875rem",
            background:
              "linear-gradient(180deg, var(--bg-secondary) 0%, var(--bg-primary) 100%)",
            boxShadow:
              "0 1.875rem 5rem -2.5rem rgba(0, 0, 0, 0.22), inset 0 0.0625rem 0 rgba(255,255,255,0.06)",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: compact ? "1rem" : "1.5rem",
              display: "flex",
              flexDirection: "column",
              gap: "0.75rem",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                paddingBottom: "0.75rem",
                borderBottom: "0.0625rem solid var(--border)",
                color: "var(--text-secondary)",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: "0.75rem",
                letterSpacing: "0.06em",
              }}
            >
              <span
                style={{
                  width: "0.375rem",
                  height: "0.375rem",
                  borderRadius: "50%",
                  background: "var(--accent)",
                  boxShadow: "0 0 0.5rem var(--accent-glow)",
                }}
              />
              <span>CHAT · this lineage</span>
              <em
                style={{
                  marginLeft: "auto",
                  fontStyle: "normal",
                  color: "var(--text-tertiary)",
                }}
              >
                sediment-agent
              </em>
            </div>

            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                gap: "0.625rem",
              }}
            >
              {messages.map((message, index) => {
                const shown = progress > (index + 0.5) / (messages.length + 1);
                return (
                  <div
                    key={`${message.role}-${index}`}
                    style={{
                      maxWidth: "78%",
                      padding: "0.625rem 0.8125rem",
                      borderRadius: "0.625rem",
                      fontSize: "0.8125rem",
                      lineHeight: 1.55,
                      opacity: shown ? 1 : 0,
                      transform: shown ? "translateY(0)" : "translateY(0.5rem)",
                      transition: "opacity 0.4s ease, transform 0.4s ease",
                      alignSelf:
                        message.role === "user" ? "flex-end" : "flex-start",
                      background:
                        message.role === "user"
                          ? "var(--accent-soft)"
                          : "var(--bg-secondary)",
                      border:
                        message.role === "user"
                          ? "0.0625rem solid color-mix(in srgb, var(--accent) 30%, transparent)"
                          : "0.0625rem solid var(--border)",
                      color:
                        message.role === "user"
                          ? "var(--text-primary)"
                          : "var(--text-secondary)",
                    }}
                  >
                    {message.text}
                    {message.cite && (
                      <span
                        style={{
                          display: "inline-flex",
                          marginLeft: "0.375rem",
                          marginTop: "0.375rem",
                          padding: "0.1875rem 0.375rem",
                          borderRadius: "0.25rem",
                          background: "var(--accent-soft)",
                          color: "var(--accent)",
                          fontFamily: "'JetBrains Mono', monospace",
                          fontSize: "0.625rem",
                          letterSpacing: "0.04em",
                        }}
                      >
                        {message.cite}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                padding: "0.625rem 0.75rem",
                border: "0.0625rem solid var(--border)",
                borderRadius: "0.5rem",
                background: "var(--bg-secondary)",
                color: "var(--text-tertiary)",
                fontSize: "0.75rem",
              }}
            >
              <span>Ask the lineage...</span>
              <span
                style={{
                  width: "0.0625rem",
                  height: "0.875rem",
                  marginLeft: "0.125rem",
                  background: "var(--accent)",
                  animation: "demo-blink 1s steps(1) infinite",
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function DemoFinalSection({
  onScrollToSearch,
  compact,
}: {
  onScrollToSearch: () => void;
  compact: boolean;
}) {
  const [hoverId, setHoverId] = useState<string | null>(null);

  return (
    <section
      style={{ padding: compact ? "4rem 1rem 2.5rem" : "10rem 2rem 4rem" }}
    >
      <div
        style={{ maxWidth: "61.25rem", margin: "0 auto", textAlign: "center" }}
      >
        <div
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: "0.6875rem",
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "var(--accent)",
          }}
        >
          An example
        </div>
        <h2
          style={{
            margin: "0.75rem 0 1rem",
            fontFamily: "'Instrument Serif', Georgia, serif",
            fontSize: compact ? "2.75rem" : "clamp(2.75rem, 6vw, 5rem)",
            fontWeight: 400,
            lineHeight: 1,
            letterSpacing: "-0.02em",
            color: "var(--text-primary)",
          }}
        >
          From the perceptron
          <br />
          <em style={{ fontStyle: "italic", color: "var(--text-secondary)" }}>
            to the transformer.
          </em>
        </h2>
        <p
          style={{
            maxWidth: "33.75rem",
            margin: "0 auto 2.25rem",
            color: "var(--text-secondary)",
            fontSize: "1.0625rem",
            lineHeight: 1.6,
          }}
        >
          Hover any node to follow the strata. This is the kind of lineage every
          search resolves into.
        </p>

        <div
          style={{
            position: "relative",
            height: compact ? "26rem" : "28.75rem",
            marginBottom: "1.75rem",
            overflow: "hidden",
            border: "0.0625rem solid var(--border)",
            borderRadius: "0.875rem",
            background:
              "linear-gradient(180deg, var(--bg-secondary) 0%, var(--bg-primary) 100%)",
            boxShadow:
              "0 1.875rem 5rem -2.5rem rgba(0, 0, 0, 0.22), inset 0 0.0625rem 0 rgba(255,255,255,0.06)",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              backgroundImage:
                "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.06) 1px, transparent 0)",
              backgroundSize: "1.5rem 1.5rem",
              pointerEvents: "none",
            }}
          />
          <DemoGraph
            positions={DEMO_FINAL_POSITIONS}
            reveal={1}
            edgeProgress={1}
            cardWidth={148}
            hoverId={hoverId}
            onHover={setHoverId}
            onLeave={() => setHoverId(null)}
            viewBoxWidth={1080}
          />
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: "0.75rem",
            flexWrap: "wrap",
            marginTop: "4rem",
          }}
        >
          <button
            type="button"
            onClick={onScrollToSearch}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              minWidth: compact ? "15.5rem" : "11.5rem",
              padding: "0.875rem 1.375rem",
              borderRadius: "0.875rem",
              border: "0.0625rem solid var(--accent)",
              background: "var(--accent)",
              color: "#fff",
              font: "500 0.875rem/1 'DM Sans', sans-serif",
              cursor: "pointer",
            }}
          >
            Trace your own concept
          </button>
          <a
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              minWidth: compact ? "15.5rem" : "11.5rem",
              padding: "0.875rem 1.375rem",
              borderRadius: "0.875rem",
              border: "0.0625rem solid var(--border-hover)",
              background: "transparent",
              color: "var(--text-primary)",
              font: "500 0.875rem/1 'DM Sans', sans-serif",
              textDecoration: "none",
              cursor: "pointer",
            }}
          >
            Star on GitHub
          </a>
        </div>
      </div>
    </section>
  );
}

function DemoFooter({ compact }: { compact: boolean }) {
  const footerLinkStyle = {
    color: "var(--text-tertiary)",
    textDecoration: "none",
    transition: "color 0.15s ease",
  } as const;

  return (
    <footer
      style={{ padding: compact ? "0.5rem 1rem 2.5rem" : "0.5rem 0 3rem" }}
    >
      <div
        style={{
          maxWidth: "82.5rem",
          margin: "0 auto",
          padding: compact ? "0" : "0 2rem",
        }}
      >
        <div
          style={{
            height: "0.0625rem",
            background: "var(--border)",
            opacity: 0.4,
            marginBottom: compact ? "1rem" : "1.25rem",
          }}
        />

        <div
          style={{
            display: "grid",
            gridTemplateColumns: compact ? "1fr" : "1fr auto 1fr",
            gap: compact ? "1.25rem" : "1.5rem",
            alignItems: "center",
            color:
              "color-mix(in srgb, var(--text-secondary) 82%, var(--bg-primary))",
            fontFamily: compact
              ? "'DM Sans', sans-serif"
              : "'JetBrains Mono', monospace",
            fontSize: compact ? "0.9375rem" : "0.75rem",
            letterSpacing: compact ? "0.01em" : "0.08em",
            textAlign: compact ? "center" : "left",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: compact ? "center" : "flex-start",
              gap: "1rem",
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.1875rem",
                opacity: 0.45,
              }}
            >
              <div
                style={{
                  width: "3.5rem",
                  height: "0.125rem",
                  background:
                    "color-mix(in srgb, var(--border-hover) 72%, var(--bg-primary))",
                }}
              />
              <div
                style={{
                  width: "2rem",
                  height: "0.125rem",
                  background:
                    "color-mix(in srgb, var(--border-hover) 72%, var(--bg-primary))",
                }}
              />
              <div
                style={{
                  width: "1.25rem",
                  height: "0.125rem",
                  background:
                    "color-mix(in srgb, var(--border-hover) 72%, var(--bg-primary))",
                }}
              />
            </div>
            <span
              style={{
                fontFamily: "'Instrument Serif', Georgia, serif",
                fontSize: "2rem",
                letterSpacing: "-0.02em",
                color:
                  "color-mix(in srgb, var(--text-primary) 82%, var(--bg-primary))",
              }}
            >
              Sediment
            </span>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexWrap: "wrap",
              gap: compact ? "1rem" : "2rem",
            }}
          >
            <a
              href={GITHUB_REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              style={footerLinkStyle}
            >
              GitHub
            </a>
            <Link href="/changelog" style={footerLinkStyle}>
              Changelog
            </Link>
            <a href="mailto:shresthkapoor7@gmail.com" style={footerLinkStyle}>
              Contact
            </a>
          </div>

          <div style={{ textAlign: compact ? "center" : "right" }}>
            © 2026 · Open source · AGPL-3.0
          </div>
        </div>
      </div>
    </footer>
  );
}

export default function Home() {
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
  const landingScrollRef = useRef<HTMLDivElement | null>(null);
  const landingSearchRef = useRef<HTMLDivElement | null>(null);
  const savedGraphIdsRef = useRef<Set<string>>(new Set());
  const { compact, mobile } = useLandingViewport();
  const [isLandingHeaderCompact, setIsLandingHeaderCompact] = useState(false);
  const [isGraphHeaderCompact, setIsGraphHeaderCompact] = useState(false);

  useEffect(() => {
    document.title = searchedQuery
      ? `${searchedQuery} — Sediment`
      : "Sediment — Knowledge, layered.";
  }, [searchedQuery]);

  const buildMetadata = useCallback(
    (query: string, data: TimelineData) => ({
      title: query,
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
    },
    [buildMetadata, graphId, selectedSeedOpenalexId, userId],
  );

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
          setSelectedSeedOpenalexId(null);
          setSaveState("idle");
          persistLastGraphId(null);
          setDisambiguation(response.disambiguation ?? []);
          return;
        }
        if (response.meta.mode === "no_results" || response.papers.length === 0) {
          setTimelineData(null);
          setGraphId(null);
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
    setIsLandingHeaderCompact(false);
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
      className="grain app-shell"
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Top bar */}
      <motion.header
        className={`app-header${!timelineData ? " app-header-landing" : ""}${timelineData ? " app-header-graph" : ""}${(!timelineData && isLandingHeaderCompact) || (timelineData && isGraphHeaderCompact) ? " app-header-compact" : ""}`}
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.75rem",
          minHeight: "4.5rem",
          padding: "0.75rem clamp(1rem, 4vw, 3rem)",
          borderBottom: "0.0625rem solid var(--border)",
          background: "var(--bg-primary)",
          zIndex: !timelineData && historyOpen ? 10 : 50,
          flexShrink: 0,
        }}
      >
        {timelineData && (
          <button
            className="app-header-brand"
            onClick={handleReset}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.625rem",
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
                fontSize: "1.125rem",
                fontWeight: 400,
                letterSpacing: "-0.01em",
              }}
            >
              Sediment
            </span>
          </button>
        )}

        <AnimatePresence>
          {searchedQuery && (
            <div
              className="app-header-query"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.625rem",
                minWidth: 0,
                overflow: "hidden",
                flexShrink: 1,
              }}
            >
              <motion.span
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                style={{
                  fontSize: "0.875rem",
                  color: "var(--text-secondary)",
                  fontFamily: "'JetBrains Mono', monospace",
                  fontWeight: 500,
                  letterSpacing: "0.02em",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  minWidth: 0,
                }}
              >
                {searchedQuery}
              </motion.span>

            </div>
          )}
        </AnimatePresence>

        {/* ── Right side: desktop buttons + always-visible controls ── */}
        <div
          className="app-header-actions"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            flexShrink: 0,
          }}
        >
          {/* Desktop buttons (hidden on mobile) */}
          <div
            className="desktop-only"
            style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
          >
            {timelineData && (
              <button
                type="button"
                className="app-header-labeled-action"
                onClick={handleReset}
                aria-label="Return to Sediment home"
                title="Return to Sediment home"
              >
                <svg
                  className="app-header-sediment-icon"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                >
                  <path d="M2 17l10 4 10-4" opacity="0.3" />
                  <path d="M2 12l10 4 10-4" opacity="0.6" />
                  <path d="M12 2L2 7l10 5 10-5L12 2z" />
                </svg>
                <span className="app-header-action-label">Sediment</span>
              </button>
            )}

            {timelineData && searchedQuery && (
              <span className="app-header-graph-query" title={searchedQuery}>
                {searchedQuery}
              </span>
            )}

            {!timelineData && (
              <motion.button
                type="button"
                className="app-header-labeled-action"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
                onClick={handleReset}
                aria-label="Sediment home"
              >
                <svg
                  className="app-header-sediment-icon"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                >
                  <path d="M2 17l10 4 10-4" opacity="0.3" />
                  <path d="M2 12l10 4 10-4" opacity="0.6" />
                  <path d="M12 2L2 7l10 5 10-5L12 2z" />
                </svg>
                <span className="app-header-action-label">Sediment</span>
              </motion.button>
            )}

            {!timelineData && (
              <motion.button
                className="app-header-labeled-action"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
                onClick={() => setHistoryOpen((open) => !open)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.375rem",
                  padding: "0 0.75rem",
                  height: "2rem",
                  boxSizing: "border-box",
                  background: historyOpen ? "var(--accent-soft)" : "none",
                  border: `0.0625rem solid ${historyOpen ? "var(--accent)" : "var(--border)"}`,
                  borderRadius: "0.4375rem",
                  color: historyOpen
                    ? "var(--accent)"
                    : "var(--text-secondary)",
                  fontSize: "0.75rem",
                  fontFamily: "'DM Sans', sans-serif",
                  fontWeight: 500,
                  cursor: "pointer",
                  transition:
                    "border-color 0.15s, color 0.15s, background 0.15s",
                }}
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M2.5 3.5h11M2.5 8h11M2.5 12.5h11" />
                  <path d="M4.5 3.5v9" opacity="0.35" />
                </svg>
                <span className="app-header-action-label">History</span>
              </motion.button>
            )}

            {!timelineData && (
              <Link
                className="app-header-labeled-action"
                href="/changelog"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.375rem",
                  padding: "0 0.75rem",
                  height: "2rem",
                  boxSizing: "border-box",
                  background: "none",
                  border: "0.0625rem solid var(--border)",
                  borderRadius: "0.4375rem",
                  color: "var(--text-secondary)",
                  fontSize: "0.75rem",
                  fontFamily: "'DM Sans', sans-serif",
                  fontWeight: 500,
                  textDecoration: "none",
                  transitionProperty: "border-color, color, background",
                  transitionDuration: "0.15s",
                }}
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M3 2.5h7l3 3v8H3z" />
                  <path d="M10 2.5v3h3M5.5 8h5M5.5 10.5h5" />
                </svg>
                <span className="app-header-action-label">Changelog</span>
              </Link>
            )}

            {/* Credits indicator */}
            <div
              className="app-header-credit"
              style={{ position: "relative" }}
              onMouseEnter={() => setShowCreditsHint(true)}
              onMouseLeave={() => setShowCreditsHint(false)}
            >
              {showCreditsHint && (
                <div
                  style={{
                    position: "absolute",
                    top: "calc(100% + 0.5rem)",
                    right: 0,
                    width: "11.5rem",
                    padding: "0.5rem 0.625rem",
                    borderRadius: "0.5rem",
                    border: "0.0625rem solid var(--border-hover)",
                    background: "var(--bg-secondary)",
                    boxShadow:
                      "0 0.5rem 1.5rem rgba(0,0,0,0.10), 0 0.125rem 0.375rem rgba(0,0,0,0.06)",
                    color: "var(--text-secondary)",
                    fontSize: "0.6875rem",
                    lineHeight: 1.45,
                    zIndex: 110,
                    pointerEvents: "none",
                  }}
                >
                  Daily usage credits. Resets every day.
                </div>
              )}
              <div className="app-header-credit-indicator">
                <div className="app-header-credit-visual" aria-hidden="true">
                  <div
                    className="app-header-credit-bars"
                    style={{ display: "flex", flexWrap: "nowrap" }}
                  >
                    {Array.from({ length: 10 }).map((_, i) => {
                      const filled = i < credits;
                      const segColor =
                        credits <= 3
                          ? "#ef4444"
                          : credits <= 6
                            ? "#f59e0b"
                            : "var(--accent)";
                      return (
                      <div
                        key={i}
                        style={{
                          width: "0.25rem",
                          height: "0.625rem",
                          borderRadius: "0.125rem",
                          background: filled ? segColor : "var(--border)",
                          opacity: filled ? 1 - i * 0.05 : 1,
                        }}
                      />
                      );
                    })}
                    <div
                      style={{
                        width: "0.125rem",
                        height: "0.3125rem",
                        borderRadius: "0 0.0625rem 0.0625rem 0",
                        background: "var(--border)",
                        marginLeft: "0.0625rem",
                      }}
                    />
                  </div>
                  <span
                    className="app-header-credit-ring"
                    aria-hidden="true"
                    style={
                      {
                        "--credit-progress": `${credits * 10}%`,
                      } as React.CSSProperties
                    }
                  />
                </div>
                <span
                  className="app-header-credit-count"
                  role="meter"
                  aria-label="Daily usage credits remaining"
                  aria-valuemin={0}
                  aria-valuemax={10}
                  aria-valuenow={credits}
                  aria-valuetext={`${credits} of 10 daily usage credits remaining`}
                  style={{
                    fontSize: "0.6875rem",
                    color:
                      credits <= 3
                        ? "#ef4444"
                        : credits <= 6
                          ? "#f59e0b"
                          : "var(--text-tertiary)",
                    fontFamily: "'JetBrains Mono', monospace",
                    letterSpacing: "0.02em",
                  }}
                >
                  {credits}
                </span>
              </div>
            </div>

            {/* Settings / graph session actions */}
            <div style={{ position: "relative" }}>
              <button
                className={`app-header-labeled-action${timelineData ? " app-header-graph-icon-action" : ""}`}
                onClick={() => {
                  if (timelineData) {
                    setSessionActionsOpen((open) => !open);
                    setSettingsOpen(false);
                    setDraftSettings(settings);
                    return;
                  }
                  setSettingsOpen((open) => {
                    setDraftSettings(settings);
                    return !open;
                  });
                }}
                aria-label={timelineData ? "Session actions" : "Settings"}
                aria-expanded={timelineData ? sessionActionsOpen : settingsOpen}
                title={timelineData ? "Session actions" : undefined}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: timelineData ? 0 : "0.375rem",
                  padding: timelineData ? 0 : "0 0.75rem",
                  width: timelineData ? "2rem" : "auto",
                  height: "2rem",
                  boxSizing: "border-box",
                  background: "none",
                  border: "0.0625rem solid var(--border)",
                  borderRadius: "0.4375rem",
                  color: "var(--text-secondary)",
                  fontSize: "0.75rem",
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
                {timelineData ? (
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                    <circle cx="3" cy="8" r="1.35" />
                    <circle cx="8" cy="8" r="1.35" />
                    <circle cx="13" cy="8" r="1.35" />
                  </svg>
                ) : (
                  <>
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M6.5 1.5h3M6 14.5h4M3.5 5.5h9M2.5 10.5h11" />
                      <circle cx="10.5" cy="5.5" r="1.5" />
                      <circle cx="5.5" cy="10.5" r="1.5" />
                    </svg>
                    <span className="app-header-action-label">Settings</span>
                  </>
                )}
              </button>

              <AnimatePresence>
                {(settingsOpen || sessionActionsOpen) && (
                  <motion.div
                    initial={{ opacity: 0, y: -6, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -6, scale: 0.98 }}
                    transition={{ duration: 0.15, ease: "easeOut" }}
                    style={{
                      position: "absolute",
                      top: "2.5rem",
                      right: 0,
                      width: timelineData ? "16rem" : "15rem",
                      padding: "0.875rem 0.875rem 0.75rem",
                      background: "var(--bg-secondary)",
                      border: "0.0625rem solid var(--border-hover)",
                      borderRadius: "0.625rem",
                      boxShadow:
                        "0 0.5rem 1.5rem rgba(0,0,0,0.10), 0 0.125rem 0.375rem rgba(0,0,0,0.06)",
                      zIndex: 100,
                      display: "flex",
                      flexDirection: "column",
                      gap: "0.625rem",
                    }}
                  >
                    {timelineData && (
                      <p
                        style={{
                          fontSize: "0.625rem",
                          color: "var(--text-tertiary)",
                          fontFamily: "'JetBrains Mono', monospace",
                          letterSpacing: "0.06em",
                          textTransform: "uppercase",
                        }}
                      >
                        Session actions
                      </p>
                    )}
                    {timelineData && (
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: "0.125rem",
                          paddingBottom: "0.625rem",
                          borderBottom: "0.0625rem solid var(--border)",
                        }}
                      >
                        <button
                          onClick={() => {
                            handleExport();
                            setSessionActionsOpen(false);
                          }}
                          style={{
                            display: "flex", alignItems: "center", gap: "0.625rem", width: "100%", height: "2rem", padding: "0 0.5rem", border: "none", borderRadius: "0.375rem", background: "none", color: "var(--text-primary)", cursor: "pointer", fontFamily: "'DM Sans', sans-serif", fontSize: "0.75rem", fontWeight: 500, textAlign: "left",
                          }}
                        >
                          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M8 2v9M4 7l4 4 4-4" /><path d="M2 13h12" /></svg>
                          Export
                        </button>
                        <button
                          onClick={() => void handleShare()}
                          disabled={shareState === "sharing"}
                          style={{
                            display: "flex", alignItems: "center", gap: "0.625rem", width: "100%", height: "2rem", padding: "0 0.5rem", border: "none", borderRadius: "0.375rem", background: "none", color: shareState === "copied" ? "var(--accent)" : "var(--text-primary)", cursor: shareState === "sharing" ? "default" : "pointer", fontFamily: "'DM Sans', sans-serif", fontSize: "0.75rem", fontWeight: 500, textAlign: "left",
                          }}
                        >
                          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke={shareState === "copied" ? "var(--accent)" : "var(--text-tertiary)"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 3a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM5 8a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM11 9a2 2 0 1 1 0 4 2 2 0 0 1 0-4z" /><path d="M9 4.5l-4 3M9 11.5l-4-3" /></svg>
                          {shareState === "sharing" ? "Sharing…" : shareState === "copied" ? "Link copied" : shareState === "error" ? "Share failed" : "Share"}
                        </button>
                        <a
                          href={GITHUB_REPO_URL}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ display: "flex", alignItems: "center", gap: "0.625rem", width: "100%", height: "2rem", padding: "0 0.5rem", borderRadius: "0.375rem", color: "var(--text-primary)", fontFamily: "'DM Sans', sans-serif", fontSize: "0.75rem", fontWeight: 500, textDecoration: "none" }}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ color: "var(--text-tertiary)" }} aria-hidden="true">
                            <path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.36-1.34-3.36-1.34-.45-1.15-1.1-1.46-1.1-1.46-.9-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.89 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02A9.5 9.5 0 0 1 12 6.84c.85 0 1.71.11 2.5.34 1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.69-4.57 4.94.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2z" />
                          </svg>
                          GitHub
                        </a>
                        <ThemeToggle className="app-header-graph-session-theme" showLabel fullWidth />
                      </div>
                    )}
                    <p
                      style={{
                        fontSize: "0.625rem",
                        color: "var(--text-tertiary)",
                        fontFamily: "'JetBrains Mono', monospace",
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                      }}
                    >
                      traversal settings
                    </p>
                    {(
                      [
                        { key: "depth", label: "Depth", min: 1, max: 2 },
                        { key: "breadth", label: "Breadth", min: 1, max: 4 },
                        {
                          key: "referenceLimit",
                          label: "Reference limit",
                          min: 5,
                          max: 30,
                        },
                        { key: "topN", label: "Top N", min: 1, max: 6 },
                      ] as const
                    ).map((item) => (
                      <SettingsSlider
                        key={item.key}
                        item={item}
                        value={draftSettings[item.key]}
                        onChange={(v) =>
                          setDraftSettings((prev) => ({
                            ...prev,
                            [item.key]: v,
                          }))
                        }
                      />
                    ))}
                    <p
                      style={{
                        margin: "0.125rem 0 0",
                        fontSize: "0.6875rem",
                        lineHeight: 1.5,
                        color: "var(--text-tertiary)",
                      }}
                    >
                      Daily limits use an anonymous server-derived identifier
                      for abuse prevention and API cost control.
                    </p>
                    <div
                      style={{
                        display: "flex",
                        gap: "0.375rem",
                        alignItems: "center",
                        marginTop: "0.125rem",
                        borderTop: "0.0625rem solid var(--border)",
                        paddingTop: "0.625rem",
                      }}
                    >
                      <button
                        onClick={() => setDraftSettings(DEFAULT_SETTINGS)}
                        style={{
                          height: "1.625rem",
                          padding: "0 0.5rem",
                          borderRadius: "0.375rem",
                          border: "none",
                          background: "none",
                          color: "var(--text-tertiary)",
                          cursor: "pointer",
                          fontSize: "0.6875rem",
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
                          if (searchedQuery && !isSearching)
                            void runSearch(
                              searchedQuery,
                              selectedSeedOpenalexId ?? undefined,
                              draftSettings,
                            );
                          setSettingsOpen(false);
                          setSessionActionsOpen(false);
                        }}
                        disabled={isExpanding}
                        style={{
                          height: "1.625rem",
                          padding: "0 0.625rem",
                          borderRadius: "0.375rem",
                          border: "0.0625rem solid var(--accent)",
                          background: "var(--accent-soft)",
                          color: "var(--accent)",
                          cursor: isExpanding ? "default" : "pointer",
                          fontSize: "0.6875rem",
                          fontFamily: "'DM Sans', sans-serif",
                          fontWeight: 600,
                          letterSpacing: "0.01em",
                        }}
                      >
                        Apply
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {timelineData && (
              <button
                type="button"
                className="app-header-labeled-action app-header-graph-compact-toggle"
                onClick={() => setIsGraphHeaderCompact((compact) => !compact)}
                aria-label={isGraphHeaderCompact ? "Expand graph dock" : "Collapse graph dock"}
                aria-pressed={isGraphHeaderCompact}
                title={isGraphHeaderCompact ? "Expand dock" : "Collapse dock"}
              >
                {isGraphHeaderCompact ? (
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M6 2H2v4M10 2h4v4M2 10v4h4M14 10v4h-4" />
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                    <path d="M2 4h12M4 8h8M6 12h4" />
                  </svg>
                )}
              </button>
            )}

            <a
              className="app-header-labeled-action"
              href={GITHUB_REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="View on GitHub"
              style={{
                display: timelineData ? "none" : "flex",
                alignItems: "center",
                justifyContent: "center",
                width: "2rem",
                height: "2rem",
                borderRadius: "0.4375rem",
                border: "0.0625rem solid var(--border)",
                color: "var(--text-secondary)",
                transition: "border-color 0.15s, color 0.15s",
                flexShrink: 0,
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLAnchorElement).style.borderColor =
                  "var(--accent)";
                (e.currentTarget as HTMLAnchorElement).style.color =
                  "var(--accent)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLAnchorElement).style.borderColor =
                  "var(--border)";
                (e.currentTarget as HTMLAnchorElement).style.color =
                  "var(--text-secondary)";
              }}
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M12 2C6.477 2 2 6.477 2 12c0 4.418 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.009-.868-.013-1.703-2.782.604-3.369-1.342-3.369-1.342-.454-1.155-1.11-1.463-1.11-1.463-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0 1 12 6.836a9.59 9.59 0 0 1 2.504.337c1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.741 0 .267.18.578.688.48C19.138 20.163 22 16.418 22 12c0-5.523-4.477-10-10-10z" />
              </svg>
              {!timelineData && (
                <span className="app-header-action-label">GitHub</span>
              )}
            </a>
          </div>

          {/* Always-visible: theme toggle + mobile hamburger */}
          <div
            style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}
          >
            {!timelineData && mobile && (
              <button
                type="button"
                className="show-mobile app-header-mobile-dock-brand app-header-labeled-action"
                onClick={handleReset}
                aria-label="Sediment home"
              >
                <svg
                  className="app-header-sediment-icon"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                >
                  <path d="M2 17l10 4 10-4" opacity="0.3" />
                  <path d="M2 12l10 4 10-4" opacity="0.6" />
                  <path d="M12 2L2 7l10 5 10-5L12 2z" />
                </svg>
                <span className="app-header-action-label">Sediment</span>
              </button>
            )}
            {!timelineData && (
              <ThemeToggle
                showLabel
                className="app-header-labeled-action"
              />
            )}

            {timelineData && (
              <button
                className="app-header-graph-icon-action"
                onClick={handleToggleGlobalChat}
                aria-label={globalChatOpen ? "Close timeline sidebar" : "Open timeline sidebar"}
                aria-pressed={globalChatOpen}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "2rem",
                  height: "2rem",
                  background: globalChatOpen ? "var(--accent-soft)" : "none",
                  border: `0.0625rem solid ${globalChatOpen ? "var(--accent)" : "var(--border)"}`,
                  borderRadius: "0.4375rem",
                  color: globalChatOpen ? "var(--accent)" : "var(--text-secondary)",
                  cursor: "pointer",
                  padding: 0,
                  transition: "border-color 0.15s, color 0.15s, background 0.15s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "var(--accent)";
                  e.currentTarget.style.color = "var(--accent)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = globalChatOpen ? "var(--accent)" : "var(--border)";
                  e.currentTarget.style.color = globalChatOpen ? "var(--accent)" : "var(--text-secondary)";
                }}
              >
                <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="2.75" y="3.25" width="14.5" height="13.5" rx="3" />
                  <path d="M8.25 3.5v13" />
                </svg>
              </button>
            )}

            {/* Hamburger — mobile only */}
            <button
              className="show-mobile"
              onClick={() => {
                setMobileMenuOpen((o) => !o);
                setDraftSettings(settings);
              }}
              aria-label="Menu"
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: "0.3rem",
                width: "2rem",
                height: "2rem",
                background: mobileMenuOpen ? "var(--accent-soft)" : "none",
                border: `0.0625rem solid ${mobileMenuOpen ? "var(--accent)" : "var(--border)"}`,
                borderRadius: "0.4375rem",
                cursor: "pointer",
                padding: 0,
                transition: "border-color 0.15s, background 0.15s",
              }}
            >
              {mobileMenuOpen ? (
                /* × close icon */
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 14 14"
                  fill="none"
                  stroke={
                    mobileMenuOpen ? "var(--accent)" : "var(--text-secondary)"
                  }
                  strokeWidth="1.75"
                  strokeLinecap="round"
                >
                  <path d="M2 2l10 10M12 2L2 12" />
                </svg>
              ) : (
                /* ☰ hamburger lines */
                <svg
                  width="14"
                  height="12"
                  viewBox="0 0 14 12"
                  fill="none"
                  stroke="var(--text-secondary)"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                >
                  <path d="M1 1h12M1 6h12M1 11h12" />
                </svg>
              )}
            </button>
          </div>
        </div>
        {/* end right-side wrapper */}

        {/* ── Mobile dropdown menu ── */}
        <AnimatePresence>
          {mobileMenuOpen && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="show-mobile"
              style={{
                position: "absolute",
                top: "100%",
                left: 0,
                right: 0,
                background: "var(--bg-primary)",
                borderBottom: "0.0625rem solid var(--border)",
                boxShadow: "0 0.5rem 1.5rem rgba(0,0,0,0.12)",
                zIndex: 200,
                padding: "0.625rem 1rem 0.875rem",
                display: "flex",
                flexDirection: "column",
                gap: "0.25rem",
              }}
            >
              {/* Credits row */}
              <div
                title="Daily usage credits. Resets every day."
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "0.5rem 0.25rem",
                  borderBottom: "0.0625rem solid var(--border)",
                  marginBottom: "0.25rem",
                }}
              >
                <span
                  style={{
                    fontSize: "0.6875rem",
                    color: "var(--text-tertiary)",
                    fontFamily: "'JetBrains Mono', monospace",
                    letterSpacing: "0.04em",
                  }}
                >
                  credits
                </span>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.375rem",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.125rem",
                    }}
                  >
                    {Array.from({ length: 10 }).map((_, i) => (
                      <div
                        key={i}
                        style={{
                          width: "0.25rem",
                          height: "0.5rem",
                          borderRadius: "0.0625rem",
                          background:
                            i < credits
                              ? credits <= 3
                                ? "#ef4444"
                                : credits <= 6
                                  ? "#f59e0b"
                                  : "var(--accent)"
                              : "var(--border)",
                          opacity: i < credits ? 1 - i * 0.05 : 1,
                        }}
                      />
                    ))}
                  </div>
                  <span
                    style={{
                      fontSize: "0.6875rem",
                      color:
                        credits <= 3
                          ? "#ef4444"
                          : credits <= 6
                            ? "#f59e0b"
                            : "var(--accent)",
                      fontFamily: "'JetBrains Mono', monospace",
                    }}
                  >
                    {credits}
                  </span>
                </div>
              </div>

              {/* History */}
              {!timelineData && (
                <button
                  onClick={() => {
                    setHistoryOpen((o) => !o);
                    setMobileMenuOpen(false);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.625rem",
                    width: "100%",
                    padding: "0.625rem 0.5rem",
                    background: "none",
                    border: "none",
                    borderRadius: "0.5rem",
                    color: "var(--text-primary)",
                    fontSize: "0.875rem",
                    fontFamily: "'DM Sans', sans-serif",
                    fontWeight: 500,
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "background 0.15s",
                  }}
                  onTouchStart={(e) => {
                    e.currentTarget.style.background = "var(--bg-secondary)";
                  }}
                  onTouchEnd={(e) => {
                    e.currentTarget.style.background = "none";
                  }}
                  onTouchCancel={(e) => {
                    e.currentTarget.style.background = "none";
                  }}
                >
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="var(--text-tertiary)"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M2.5 3.5h11M2.5 8h11M2.5 12.5h11" />
                    <path d="M4.5 3.5v9" opacity="0.35" />
                  </svg>
                  History
                </button>
              )}

              {!timelineData && (
                <Link
                  href="/changelog"
                  onClick={() => setMobileMenuOpen(false)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.625rem",
                    width: "100%",
                    padding: "0.625rem 0.5rem",
                    borderRadius: "0.5rem",
                    color: "var(--text-primary)",
                    fontSize: "0.875rem",
                    fontFamily: "'DM Sans', sans-serif",
                    fontWeight: 500,
                    textDecoration: "none",
                  }}
                >
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="var(--text-tertiary)"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M3 2.5h7l3 3v8H3z" />
                    <path d="M10 2.5v3h3M5.5 8h5M5.5 10.5h5" />
                  </svg>
                  Changelog
                </Link>
              )}

              {/* Settings — inline sliders */}
              <div style={{ padding: "0.5rem 0.5rem 0.25rem" }}>
                <p
                  style={{
                    fontSize: "0.625rem",
                    color: "var(--text-tertiary)",
                    fontFamily: "'JetBrains Mono', monospace",
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    marginBottom: "0.625rem",
                  }}
                >
                  traversal settings
                </p>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.625rem",
                  }}
                >
                  {(
                    [
                      { key: "depth", label: "Depth", min: 1, max: 2 },
                      { key: "breadth", label: "Breadth", min: 1, max: 4 },
                      {
                        key: "referenceLimit",
                        label: "Ref limit",
                        min: 5,
                        max: 30,
                      },
                      { key: "topN", label: "Top N", min: 1, max: 6 },
                    ] as const
                  ).map((item) => (
                    <SettingsSlider
                      key={item.key}
                      item={item}
                      value={draftSettings[item.key]}
                      onChange={(v) =>
                        setDraftSettings((prev) => ({ ...prev, [item.key]: v }))
                      }
                    />
                  ))}
                </div>
                <p
                  style={{
                    marginTop: "0.625rem",
                    fontSize: "0.75rem",
                    lineHeight: 1.5,
                    color: "var(--text-tertiary)",
                  }}
                >
                  Daily limits use an anonymous server-derived identifier for
                  abuse prevention and API cost control.
                </p>
                <div
                  style={{
                    display: "flex",
                    gap: "0.375rem",
                    marginTop: "0.75rem",
                  }}
                >
                  <button
                    onClick={() => setDraftSettings(DEFAULT_SETTINGS)}
                    style={{
                      flex: 1,
                      height: "2.25rem",
                      borderRadius: "0.5rem",
                      border: "0.0625rem solid var(--border)",
                      background: "none",
                      color: "var(--text-secondary)",
                      cursor: "pointer",
                      fontSize: "0.8125rem",
                      fontFamily: "'DM Sans', sans-serif",
                      fontWeight: 500,
                    }}
                  >
                    Reset
                  </button>
                  <button
                    onClick={() => {
                      if (isExpanding) return;
                      setSettings(draftSettings);
                      if (searchedQuery && !isSearching)
                        void runSearch(
                          searchedQuery,
                          selectedSeedOpenalexId ?? undefined,
                          draftSettings,
                        );
                      setMobileMenuOpen(false);
                    }}
                    disabled={isExpanding}
                    style={{
                      flex: 1,
                      height: "2.25rem",
                      borderRadius: "0.5rem",
                      border: "0.0625rem solid var(--accent)",
                      background: "var(--accent)",
                      color: "#fff",
                      cursor: isExpanding ? "default" : "pointer",
                      fontSize: "0.8125rem",
                      fontFamily: "'DM Sans', sans-serif",
                      fontWeight: 600,
                    }}
                  >
                    Apply
                  </button>
                </div>
              </div>

              {/* Divider before action buttons */}
              {timelineData && (
                <div
                  style={{
                    height: "0.0625rem",
                    background: "var(--border)",
                    margin: "0.25rem 0",
                  }}
                />
              )}

              {/* Export */}
              {timelineData && (
                <button
                  onClick={() => {
                    handleExport();
                    setMobileMenuOpen(false);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.625rem",
                    width: "100%",
                    padding: "0.625rem 0.5rem",
                    background: "none",
                    border: "none",
                    borderRadius: "0.5rem",
                    color: "var(--text-primary)",
                    fontSize: "0.875rem",
                    fontFamily: "'DM Sans', sans-serif",
                    fontWeight: 500,
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                  onTouchStart={(e) => {
                    e.currentTarget.style.background = "var(--bg-secondary)";
                  }}
                  onTouchEnd={(e) => {
                    e.currentTarget.style.background = "none";
                  }}
                  onTouchCancel={(e) => {
                    e.currentTarget.style.background = "none";
                  }}
                >
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="var(--text-tertiary)"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M8 2v9M4 7l4 4 4-4" />
                    <path d="M2 13h12" />
                  </svg>
                  Export Markdown
                </button>
              )}

              {/* Share */}
              {timelineData && (
                <button
                  onClick={() => {
                    void handleShare();
                    setMobileMenuOpen(false);
                  }}
                  disabled={shareState === "sharing"}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.625rem",
                    width: "100%",
                    padding: "0.625rem 0.5rem",
                    background: "none",
                    border: "none",
                    borderRadius: "0.5rem",
                    color:
                      shareState === "copied"
                        ? "var(--accent)"
                        : "var(--text-primary)",
                    fontSize: "0.875rem",
                    fontFamily: "'DM Sans', sans-serif",
                    fontWeight: 500,
                    cursor: shareState === "sharing" ? "default" : "pointer",
                    textAlign: "left",
                  }}
                  onTouchStart={(e) => {
                    e.currentTarget.style.background = "var(--bg-secondary)";
                  }}
                  onTouchEnd={(e) => {
                    e.currentTarget.style.background = "none";
                  }}
                  onTouchCancel={(e) => {
                    e.currentTarget.style.background = "none";
                  }}
                >
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke={
                      shareState === "copied"
                        ? "var(--accent)"
                        : "var(--text-tertiary)"
                    }
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M11 3a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM5 8a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM11 9a2 2 0 1 1 0 4 2 2 0 0 1 0-4z" />
                    <path d="M9 4.5l-4 3M9 11.5l-4-3" />
                  </svg>
                  {shareState === "sharing"
                    ? "Sharing..."
                    : shareState === "copied"
                      ? "Link copied!"
                      : shareState === "error"
                        ? "Share failed"
                        : "Copy share link"}
                </button>
              )}

              {/* GitHub */}
              <a
                href={GITHUB_REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setMobileMenuOpen(false)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.625rem",
                  padding: "0.625rem 0.5rem",
                  borderRadius: "0.5rem",
                  color: "var(--text-primary)",
                  fontSize: "0.875rem",
                  fontFamily: "'DM Sans', sans-serif",
                  fontWeight: 500,
                  textDecoration: "none",
                }}
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="var(--text-tertiary)"
                >
                  <path d="M12 2C6.477 2 2 6.477 2 12c0 4.418 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.009-.868-.013-1.703-2.782.604-3.369-1.342-3.369-1.342-.454-1.155-1.11-1.463-1.11-1.463-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0 1 12 6.836a9.59 9.59 0 0 1 2.504.337c1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.741 0 .267.18.578.688.48C19.138 20.163 22 16.418 22 12c0-5.523-4.477-10-10-10z" />
                </svg>
                View source
              </a>
              {timelineData && (
                <ThemeToggle className="app-header-mobile-menu-theme" showLabel fullWidth />
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.header>

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
                  top: "0.875rem",
                  right: "0.875rem",
                  bottom: "0.875rem",
                  width: "21.25rem",
                  maxWidth: "calc(100vw - 1.75rem)",
                  borderRadius: "1.25rem",
                  border: "0.0625rem solid var(--border-hover)",
                  background:
                    "color-mix(in srgb, var(--bg-primary) 86%, #1e1510 14%)",
                  boxShadow: "0 1.125rem 3rem rgba(0,0,0,0.22)",
                  backdropFilter: "blur(1.125rem)",
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
                      borderRadius: "0.5rem",
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
                        fontFamily: "'JetBrains Mono', monospace",
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
                        fontFamily: "'Instrument Serif', Georgia, serif",
                        fontWeight: 400,
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
                        borderRadius: "1rem",
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
                        borderRadius: "1rem",
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
                          borderRadius: "1rem",
                          border: "0.0625rem solid var(--border)",
                          background: "var(--bg-secondary)",
                          color: "var(--text-primary)",
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
                                borderRadius: 999,
                                border: "none",
                                background: deletingGraphId === graph.id ? "var(--bg-tertiary)" : "var(--accent-soft)",
                                color: deletingGraphId === graph.id ? "var(--text-tertiary)" : "var(--accent)",
                                cursor: deletingGraphId ? "default" : "pointer",
                                flexShrink: 0,
                                transition: "background 0.15s, color 0.15s, transform 0.15s",
                              }}
                              onMouseEnter={(e) => {
                                if (deletingGraphId) return;
                                e.currentTarget.style.background = "color-mix(in srgb, var(--accent-soft) 72%, var(--accent) 28%)";
                                e.currentTarget.style.transform = "translateY(-1px)";
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.background = deletingGraphId === graph.id ? "var(--bg-tertiary)" : "var(--accent-soft)";
                                e.currentTarget.style.transform = "translateY(0)";
                              }}
                            >
                              {deletingGraphId === graph.id ? (
                                <span
                                  style={{
                                    fontSize: 10,
                                    fontFamily: "'JetBrains Mono', monospace",
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
                              fontFamily: "'JetBrains Mono', monospace",
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
                          borderRadius: "0.875rem",
                          border: "0.0625rem solid var(--border)",
                          background: "var(--bg-secondary)",
                          color: isHistoryLoadingMore ? "var(--text-tertiary)" : "var(--accent)",
                          cursor: isHistoryLoadingMore ? "default" : "pointer",
                          fontSize: "0.75rem",
                          fontFamily: "'JetBrains Mono', monospace",
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
                  background: "rgba(16, 12, 8, 0.38)",
                  border: "none",
                  zIndex: 40,
                  cursor: "pointer",
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
                  borderRadius: 18,
                  border: "1px solid var(--border-hover)",
                  background: "color-mix(in srgb, var(--bg-primary) 92%, #1e1510 8%)",
                  boxShadow: "0 22px 60px rgba(0,0,0,0.28)",
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
                      fontFamily: "'JetBrains Mono', monospace",
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
                      fontFamily: "'Instrument Serif', Georgia, serif",
                      fontWeight: 400,
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
                      borderRadius: 8,
                      border: "1px solid var(--border)",
                      background: "none",
                      color: "var(--text-secondary)",
                      cursor: "pointer",
                      fontSize: 12,
                      fontFamily: "'DM Sans', sans-serif",
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
                      borderRadius: 8,
                      border: "1px solid var(--accent)",
                      background: "var(--accent-soft)",
                      color: "var(--accent)",
                      cursor: "pointer",
                      fontSize: 12,
                      fontFamily: "'DM Sans', sans-serif",
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
              ref={landingScrollRef}
              onScroll={(event) => {
                setIsLandingHeaderCompact(event.currentTarget.scrollTop > 48);
              }}
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
                <div className="landing-hero-strata" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                  <span />
                  <svg
                    className="landing-helix-particles landing-helix-particles-desktop"
                    viewBox="0 0 1248 448"
                    preserveAspectRatio="none"
                  >
                    <g className="landing-helix-particle">
                      <animateMotion
                        dur="26s"
                        repeatCount="indefinite"
                        path="M202.6 102.37 A524.16 64 -5 1 1 886.9 136.85 A586.56 64 4 1 0 1065.12 248.63 A474.24 64 -3 1 0 909.29 284.48 A561.6 64 4 1 1 175.2 250.63 A474.24 64 -3 0 1 335.98 211.95 A586.56 64 4 1 0 202.6 102.37"
                      />
                      <animate
                        attributeName="opacity"
                        values="0;0.9;0.9;0"
                        keyTimes="0;0.035;0.96;1"
                        dur="26s"
                        repeatCount="indefinite"
                      />
                      <circle className="landing-helix-core" r="4.25" />
                    </g>
                    <g className="landing-helix-particle landing-helix-particle-secondary">
                      <animateMotion
                        dur="26s"
                        begin="-13s"
                        repeatCount="indefinite"
                        path="M202.6 102.37 A586.56 64 4 1 1 335.98 211.95 A474.24 64 -3 0 0 175.2 250.63 A561.6 64 4 1 0 909.29 284.48 A474.24 64 -3 1 1 1065.12 248.63 A586.56 64 4 1 1 886.9 136.85 A524.16 64 -5 1 0 202.6 102.37"
                      />
                      <animate
                        attributeName="opacity"
                        values="0;0.7;0.7;0"
                        keyTimes="0;0.035;0.96;1"
                        dur="26s"
                        begin="-13s"
                        repeatCount="indefinite"
                      />
                      <circle className="landing-helix-core" r="4.25" />
                    </g>
                  </svg>
                  <MobileLandingHelixParticles />
                </div>

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

                <dl className="landing-hero-ledger" aria-label="How Sediment works">
                  <div>
                    <dt>01</dt>
                    <dd>Begin with a question</dd>
                  </div>
                  <div>
                    <dt>02</dt>
                    <dd>Resolve the anchor paper</dd>
                  </div>
                  <div>
                    <dt>03</dt>
                    <dd>Trace its foundations</dd>
                  </div>
                </dl>

                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.6, duration: 1 }}
                  className="hide-mobile landing-hero-footer"
                >
                  <a
                    href={GITHUB_REPO_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="landing-open-source"
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLAnchorElement).style.color =
                        "var(--accent)";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLAnchorElement).style.color =
                        "var(--text-tertiary)";
                    }}
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                    >
                      <path d="M12 2C6.477 2 2 6.477 2 12c0 4.418 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.009-.868-.013-1.703-2.782.604-3.369-1.342-3.369-1.342-.454-1.155-1.11-1.463-1.11-1.463-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0 1 12 6.836a9.59 9.59 0 0 1 2.504.337c1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.741 0 .267.18.578.688.48C19.138 20.163 22 16.418 22 12c0-5.523-4.477-10-10-10z" />
                    </svg>
                    open source
                  </a>
                  <LandingScrollHint containerRef={landingScrollRef} />
                </motion.div>
              </section>

              <div style={{ position: "relative" }}>
                <DemoTypeScene
                  containerRef={landingScrollRef}
                  compact={compact}
                />
                <DemoLineageScene
                  containerRef={landingScrollRef}
                  compact={compact}
                />
                <DemoDetailScene
                  containerRef={landingScrollRef}
                  compact={compact}
                />
                <DemoChatScene
                  containerRef={landingScrollRef}
                  compact={compact}
                />
                <DemoFinalSection
                  onScrollToSearch={handleScrollToSearch}
                  compact={compact}
                />
                <DemoFooter compact={compact} />
              </div>
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
              {/* Strata loading animation */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.25rem",
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
                      height: "0.125rem",
                      borderRadius: "0.0625rem",
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
                  fontSize: "0.8125rem",
                  color: "var(--text-tertiary)",
                  fontFamily: "'JetBrains Mono', monospace",
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
