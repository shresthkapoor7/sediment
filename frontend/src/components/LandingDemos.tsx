"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { LogoMark } from "@/components/LogoMark";
import { useLandingViewport } from "@/lib/use-landing-viewport";

const GITHUB_REPO_URL = "https://github.com/shresthkapoor7/sediment";

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
    const container = containerRef.current;
    if (!container) return;
    let last = -1;

    const compute = () => {
      const section = sectionRef.current;
      if (!section) return;

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
    };

    // Compute once on mount, then only when the container actually scrolls or resizes —
    // no perpetual rAF, so the tab is idle when the user isn't scrolling.
    compute();
    container.addEventListener("scroll", compute, { passive: true });
    window.addEventListener("resize", compute);
    return () => {
      container.removeEventListener("scroll", compute);
      window.removeEventListener("resize", compute);
    };
  }, [containerRef, sectionRef]);

  return progress;
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
            fontFamily: "var(--font-mono), monospace",
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
          fontFamily: "var(--font-mono), monospace",
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

          return (
            <path
              key={`${from}-${to}`}
              d={buildBezierPath(x1, y1, x2, y2)}
              className={`demo-graph-edge${isHighlighted ? " is-highlighted" : ""}`}
              pathLength={1}
              strokeDasharray={1}
              strokeDashoffset={1 - localProgress}
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
              fontFamily: "var(--font-mono), monospace",
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
              fontFamily: "var(--font-sans), sans-serif",
              fontWeight: 600,
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
                fontFamily: "var(--font-mono), monospace",
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
                    fontFamily: "var(--font-mono), monospace",
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
              fontFamily: "var(--font-mono), monospace",
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
              fontFamily: "var(--font-sans), sans-serif",
              fontWeight: 600,
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
              fontFamily: "var(--font-mono), monospace",
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
              fontFamily: "var(--font-mono), monospace",
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
              fontFamily: "var(--font-sans), sans-serif",
              fontWeight: 600,
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
                fontFamily: "var(--font-mono), monospace",
                fontSize: "0.625rem",
                letterSpacing: "0.04em",
                marginBottom: "0.5rem",
              }}
            >
              2017 · NeurIPS
            </div>
            <h4
              style={{
                fontFamily: "var(--font-sans), sans-serif",
                fontSize: "1.375rem",
                fontWeight: 600,
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
                  fontFamily: "var(--font-mono), monospace",
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
                  fontFamily: "var(--font-mono), monospace",
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
                  fontFamily: "var(--font-mono), monospace",
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
              fontFamily: "var(--font-mono), monospace",
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
              fontFamily: "var(--font-sans), sans-serif",
              fontWeight: 600,
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
                fontFamily: "var(--font-mono), monospace",
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
                          fontFamily: "var(--font-mono), monospace",
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
      className="demo-final-section"
      style={{ padding: compact ? "4rem 1rem 2.5rem" : "5rem 2rem 4rem" }}
    >
      <div
        style={{ maxWidth: "61.25rem", margin: "0 auto", textAlign: "center" }}
      >
        <div
          style={{
            fontFamily: "var(--font-mono), monospace",
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
            fontFamily: "var(--font-sans), sans-serif",
            fontSize: compact ? "2.75rem" : "clamp(2.75rem, 6vw, 5rem)",
            fontWeight: 600,
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
              font: "500 0.875rem/1 var(--font-sans), sans-serif",
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
              font: "500 0.875rem/1 var(--font-sans), sans-serif",
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
    color: "#FFFFFF",
    textDecoration: "none",
    transition: "color 0.15s ease",
  } as const;

  return (
    <footer
      className="landing-page-lift-footer"
      style={{
        marginTop: 0,
        padding: compact ? "1.5rem 1rem 2.5rem" : "2rem 0 3rem",
        background: "var(--accent)",
        color: "#FFFFFF",
        position: "sticky",
        bottom: 0,
        zIndex: 0,
      }}
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
            display: "grid",
            gridTemplateColumns: compact ? "1fr" : "1fr auto 1fr",
            gap: compact ? "1.25rem" : "1.5rem",
            alignItems: "center",
            color: "#FFFFFF",
            fontFamily: compact
              ? "var(--font-sans), sans-serif"
              : "var(--font-mono), monospace",
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
            <LogoMark
              width="32"
              height="32"
              style={{ color: "#FFFFFF", flexShrink: 0 }}
            />
            <span
              style={{
                fontFamily: "var(--font-sans), sans-serif",
                fontSize: "2rem",
                fontWeight: 600,
                letterSpacing: "-0.02em",
                color: "#FFFFFF",
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

interface LandingDemosProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  compact: boolean;
  onScrollToSearch: () => void;
}

export default function LandingDemos({ containerRef, compact, onScrollToSearch }: LandingDemosProps) {
  return (
    <>
      <div
        style={{
          position: "relative",
          zIndex: 1,
          background: "var(--bg-primary)",
          boxShadow: "0 1.25rem 2.5rem rgba(0, 0, 0, 0.18)",
        }}
      >
        <DemoTypeScene containerRef={containerRef} compact={compact} />
        <DemoLineageScene containerRef={containerRef} compact={compact} />
        <DemoDetailScene containerRef={containerRef} compact={compact} />
        <DemoChatScene containerRef={containerRef} compact={compact} />
      </div>
      <div style={{ position: "relative", overflow: "clip" }}>
        <div
          style={{
            position: "relative",
            zIndex: 1,
            background: "var(--bg-primary)",
            boxShadow: "0 1.25rem 2.5rem rgba(0, 0, 0, 0.18)",
          }}
        >
          <DemoFinalSection onScrollToSearch={onScrollToSearch} compact={compact} />
        </div>
        <DemoFooter compact={compact} />
      </div>
    </>
  );
}
