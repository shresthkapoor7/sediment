"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { m } from "framer-motion";
import { AppHeader } from "@/components/AppHeader";
import { CanvasGroupRegion } from "@/components/CanvasGroupRegion";
import { ChatTabs } from "@/components/ChatTabs";
import { TimelineEdgeLine } from "@/components/TimelineEdge";
import { TimelineNodeCard } from "@/components/TimelineNode";
import { TimelineNoteCard } from "@/components/TimelineNote";
import { TimelineNoteEdgeLine } from "@/components/TimelineNoteEdge";
import { computeGroupRegions, regionFrame } from "@/lib/groups";
import type { TimelineData, TimelineNode, TimelineNote } from "@/lib/types";
import styles from "./LandingDemo.module.css";

/*
 * The home page demo: one scripted agent turn, drawn with the real canvas components (paper cards, links,
 * cluster region, note, header, chat tabs) at the app's own size and scaled down to fit. Nothing calls the
 * backend. Every frame comes from one clock, so pausing it (off screen, or reduced motion) freezes the scene.
 */

const APP = { width: 1440, height: 860 };
const PANEL_WIDTH = 380;
const WORLD = { x: 404, y: 36, zoom: 0.82 };

const PROMPT = "Map how diffusion models came out of score matching, and note what's still open.";
const ANSWER =
  "Two lines meet here. Score matching (Vincent, then Song and Ermon) and the thermodynamic view (Sohl-Dickstein) both lead to DDPM, and the SDE paper shows they are one family of models. Latent diffusion then made it cheap enough for large images.";

// Phase lengths in ms, in order.
const PHASES = {
  typing: 2300,
  thinking: 1000,
  search: 1300,
  references: 1100,
  place: 1500,
  link: 1300,
  note: 1200,
  answer: 3200,
  hold: 4200,
} as const;
type Phase = keyof typeof PHASES;
const ORDER = Object.keys(PHASES) as Phase[];
const STARTS = ORDER.reduce<Record<Phase, number>>((acc, phase, index) => {
  acc[phase] = index === 0 ? 0 : acc[ORDER[index - 1]] + PHASES[ORDER[index - 1]];
  return acc;
}, {} as Record<Phase, number>);
const LOOP = STARTS.hold + PHASES.hold;
const TICK = 50;

function paperNode(id: number, x: number, y: number, year: number, title: string, summary: string, authors: string[]): TimelineNode {
  return {
    id, x, y, lane: 0, parentId: null, expanded: false, generation: 1,
    paper: { id, openalexId: `demo-${id}`, title, year, summary, authors },
  };
}

// Real papers, opening lines of their real abstracts. Older work on the left.
const NODES: TimelineNode[] = [
  paperNode(1, 60, 120, 2011, "A Connection Between Score Matching and Denoising Autoencoders",
    "Denoising autoencoders have been previously shown to be competitive alternatives to restricted Boltzmann machines for unsupervised pretraining.",
    ["Pascal Vincent"]),
  paperNode(2, 60, 400, 2015, "Deep Unsupervised Learning using Nonequilibrium Thermodynamics",
    "A central problem in machine learning involves modeling complex data-sets using highly flexible families of probability distributions.",
    ["Jascha Sohl-Dickstein", "Eric Weiss", "Niru Maheswaranathan", "Surya Ganguli"]),
  paperNode(3, 476, 120, 2019, "Generative Modeling by Estimating Gradients of the Data Distribution",
    "We introduce a new generative model where samples are produced via Langevin dynamics using gradients of the data distribution estimated with score matching.",
    ["Yang Song", "Stefano Ermon"]),
  paperNode(4, 476, 400, 2020, "Denoising Diffusion Probabilistic Models",
    "We present high quality image synthesis results using diffusion probabilistic models, a class of latent variable models inspired by nonequilibrium thermodynamics.",
    ["Jonathan Ho", "Ajay Jain", "Pieter Abbeel"]),
  paperNode(5, 892, 120, 2021, "Score-Based Generative Modeling through Stochastic Differential Equations",
    "Creating noise from data is easy; creating data from noise is generative modeling.",
    ["Yang Song", "Jascha Sohl-Dickstein", "Diederik P. Kingma", "Abhishek Kumar", "Stefano Ermon", "Ben Poole"]),
  paperNode(6, 892, 400, 2022, "High-Resolution Image Synthesis with Latent Diffusion Models",
    "By decomposing the image formation process into a sequential application of denoising autoencoders, diffusion models achieve state-of-the-art synthesis results.",
    ["Robin Rombach", "Andreas Blattmann", "Dominik Lorenz", "Patrick Esser", "Björn Ommer"]),
];
const LINKS: [number, number][] = [[1, 3], [2, 4], [3, 5], [4, 5], [4, 6]];
const CLUSTER = { label: "Score matching", members: [1, 3] };
const NOTE: TimelineNote = {
  id: "demo-note",
  kind: "question",
  color: "amber",
  text: "Open: why does sampling still take so many steps, and does distillation close the gap without losing quality?",
  x: 500,
  y: 650,
  width: 300,
  height: 150,
};

const noop = () => {};
const EMPTY_TIMELINE = { nodes: {}, adjacency: {}, lanes: 1, rootId: 1, expansions: [] } as TimelineData;

function useDemoClock(root: React.RefObject<HTMLElement | null>) {
  const [time, setTime] = useState(0);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Show the finished scene instead of animating it.
      setTime(STARTS.hold);
      return;
    }
    const node = root.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => setRunning(entry.isIntersecting), { threshold: 0.25 });
    observer.observe(node);
    return () => observer.disconnect();
  }, [root]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setTime((current) => (current + TICK) % LOOP), TICK);
    return () => window.clearInterval(timer);
  }, [running]);

  return time;
}

function useFitScale(frame: React.RefObject<HTMLElement | null>) {
  const [scale, setScale] = useState(0.78);
  useLayoutEffect(() => {
    const node = frame.current;
    if (!node) return;
    const update = () => setScale(node.clientWidth / APP.width);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [frame]);
  return scale;
}

type ToolLine = { key: string; label: string; done: boolean };

export function LandingDemo() {
  const frameRef = useRef<HTMLDivElement>(null);
  const time = useDemoClock(frameRef);
  const scale = useFitScale(frameRef);

  const reached = (phase: Phase) => time >= STARTS[phase];
  const progress = (phase: Phase) => Math.min(Math.max((time - STARTS[phase]) / PHASES[phase], 0), 1);
  const finished = (phase: Phase) => time >= STARTS[phase] + PHASES[phase] * 0.7;

  const sent = reached("thinking");
  const typed = sent ? "" : PROMPT.slice(0, Math.round(PROMPT.length * Math.min(progress("typing") * 1.15, 1)));
  const answer = ANSWER.slice(0, Math.round(ANSWER.length * progress("answer")));
  const thinking = sent && !reached("search");
  // Each loop restarts the cards and links, so their entrance animations play again.
  const loop = Math.floor(time / LOOP);

  const papersShown = reached("place") ? Math.min(Math.ceil(progress("place") * NODES.length * 1.5), NODES.length) : 0;
  const nodes = NODES.slice(0, papersShown).map((node) =>
    reached("link") && CLUSTER.members.includes(node.id) ? { ...node, group: CLUSTER.label } : node,
  );
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const regions = useMemo(() => computeGroupRegions(nodes), [nodes]);

  const tools: ToolLine[] = [];
  if (reached("search")) tools.push({ key: "search", label: finished("search") ? "Searched OpenAlex · 24 candidates" : "Searching OpenAlex", done: finished("search") });
  if (reached("references")) tools.push({ key: "refs", label: finished("references") ? "Read references · 6 papers" : "Reading references", done: finished("references") });
  if (reached("place")) tools.push({ key: "canvas", label: reached("link") ? "Canvas updated · 6 added, 5 linked, 1 cluster set" : "Updating canvas", done: reached("link") && finished("link") });
  if (reached("note")) tools.push({ key: "note", label: finished("note") ? "Created 1 canvas note" : "Creating canvas notes", done: finished("note") });

  const fading = time > LOOP - 450;

  return (
    <div ref={frameRef} className={styles.frame} data-fading={fading || undefined} style={{ height: APP.height * scale }}>
      <p className={styles.srOnly}>
        A demo of the agent: asked how diffusion models came out of score matching, it searches OpenAlex, places six papers
        from 2011 to 2022 on the canvas, links their citations, groups two into a cluster, leaves a note and answers.
      </p>
      <div className={`canvas-shell ${styles.app}`} aria-hidden="true" inert style={{ width: APP.width, height: APP.height, transform: `scale(${scale})` }}>
        <AppHeader
          timelineData={EMPTY_TIMELINE}
          mobile={false}
          searchedQuery=""
          graphTitle="Diffusion models: origins"
          graphDescription=""
          graphTitleDraft=""
          isEditingGraphTitle={false}
          canEditGraphTitle={false}
          graphTitleInputRef={{ current: null }}
          mobileMenuOpen={false}
          globalChatOpen
          credits={8}
          shareState="idle"
          landingScrollEl={null}
          setMobileMenuOpen={noop}
          setGraphTitleDraft={noop}
          handleReset={noop}
          handleExport={noop}
          handleShare={noop}
          handleToggleGlobalChat={noop}
          startGraphTitleEdit={noop}
          saveGraphTitle={noop}
          cancelGraphTitleEdit={noop}
        />

        <div className={styles.canvas}>
          <div className={styles.world} style={{ transform: `translate(${WORLD.x}px, ${WORLD.y}px) scale(${WORLD.zoom})` }}>
            {regions.map((region) => (
              <m.div key={`${loop}-${region.key}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}>
                <CanvasGroupRegion label={region.label} count={region.count} frame={regionFrame(region)} />
              </m.div>
            ))}

            <svg className={styles.edges} width={1400} height={900}>
              <defs>
                <marker id="arrow-default" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto" markerUnits="strokeWidth">
                  <path d="M0,0 L0,6 L8,3 z" fill="var(--edge-color)" opacity="0.7" />
                </marker>
              </defs>
              {reached("link") && LINKS.map(([from, to], index) => {
                const a = byId.get(from);
                const b = byId.get(to);
                return a && b ? <TimelineEdgeLine key={`${loop}-${from}-${to}`} from={a} to={b} index={index} isActive={false} /> : null;
              })}
              {reached("note") && byId.get(4) && (
                <TimelineNoteEdgeLine key={`${loop}-note`} note={NOTE} node={byId.get(4)!} edge={{ noteId: NOTE.id, nodeId: 4 }} index={0} />
              )}
            </svg>

            {nodes.map((node, index) => (
              <TimelineNodeCard key={`${loop}-${node.id}`} node={node} index={index} onClick={noop} isActive={false} shouldAnimate />
            ))}

            {reached("note") && (
              <m.div key={`${loop}-note-card`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }}>
                <TimelineNoteCard note={NOTE} connectedNodeCount={1} readOnly />
              </m.div>
            )}
          </div>

          <div className={styles.toolbar}>
            <span className={styles.addPaper}>
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M6 1.5v9M1.5 6h9" /></svg>
              Add paper
            </span>
            <span className={styles.toolButton}>−</span>
            <span className={styles.toolButton}>+</span>
            <span className={styles.toolButton}>⌂</span>
            <span className={styles.zoom}>82%</span>
          </div>

          <aside className={styles.panel} style={{ width: PANEL_WIDTH }}>
            <ChatTabs
              tabs={[{ id: "demo", title: "Diffusion origins" }]}
              activeId="demo"
              busyIds={sent && !reached("answer") ? new Set(["demo"]) : new Set()}
              canAdd
              onSelect={noop}
              onAdd={noop}
              onClose={noop}
              onClosePanel={noop}
              idPrefix="landing-demo"
            />
            <div className={styles.thread}>
              {sent && (
                <div className={styles.userRow}>
                  <div className={styles.userBubble}>{PROMPT}</div>
                </div>
              )}
              {(tools.length > 0 || answer) && (
                <div className={styles.assistantRow}>
                  {answer && <div className={styles.answer}>{answer}</div>}
                  <div className={styles.tools}>
                    {tools.map((tool) => (
                      <div key={tool.key} className={styles.tool}>
                        <span style={{ color: tool.done ? "var(--text-tertiary)" : "var(--accent)" }}>{tool.done ? "✓" : "↻"}</span>
                        {tool.label}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {thinking && (
                <div className={styles.typing}>
                  {[0, 1, 2].map((i) => <div key={i} className="sediment-typing-dot" style={{ animationDelay: `${i * 0.2}s` }} />)}
                </div>
              )}
            </div>
            <div className={styles.composerWrap}>
              <div className={styles.composer}>
                <span className={typed ? styles.composerText : styles.composerPlaceholder}>
                  {typed || "Ask anything, @ to mention a paper"}
                </span>
                <span className={styles.send} data-ready={(!!typed && !sent) || undefined}>
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="var(--on-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 8H2M8 2l6 6-6 6" /></svg>
                </span>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
