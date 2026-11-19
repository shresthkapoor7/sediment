"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { m } from "framer-motion";
import { AppHeader } from "@/components/AppHeader";
import { CanvasGroupRegion } from "@/components/CanvasGroupRegion";
import { CanvasHistory } from "@/components/CanvasHistory";
import { CanvasMinimap, type MinimapItem, type MinimapView } from "@/components/CanvasMinimap";
import { ChatTabs } from "@/components/ChatTabs";
import { TimelineEdgeLine } from "@/components/TimelineEdge";
import { TimelineNodeCard } from "@/components/TimelineNode";
import { TimelineNoteCard } from "@/components/TimelineNote";
import { TimelineNoteEdgeLine } from "@/components/TimelineNoteEdge";
import { NODE_DIMENSIONS } from "@/lib/layout-constants";
import { computeGroupRegions, regionFrame } from "@/lib/groups";
import type { TimelineData, TimelineNode, TimelineNote } from "@/lib/types";
import styles from "./LandingDemo.module.css";

/*
 * The home page demo: the app sped up. Two agent turns in two chats, drawn with the real components (header,
 * description, paper cards, links, cluster, note, toolbar, history, minimap, chat tabs) at the app's own size
 * and scaled down to fit. Nothing calls the backend. Every frame comes from one clock, so pausing it (off
 * screen, or reduced motion) freezes the scene.
 */

const APP = { width: 1600, height: 1000 };
const HEADER_HEIGHT = 73;
const CANVAS = { width: APP.width, height: APP.height - HEADER_HEIGHT };
const PANEL_WIDTH = 400;
// Where fitted content may sit on the canvas: right of the agent panel, above the toolbar.
const FIT_AREA = { left: PANEL_WIDTH + 48, right: CANVAS.width - 48, top: 36, bottom: CANVAS.height - 88 };

const PROMPT_ONE = "Map how diffusion models came out of score matching, and note what's still open.";
const ANSWER_ONE =
  "Two lines meet here. Score matching (Vincent, then Song and Ermon) and the thermodynamic view (Sohl-Dickstein) both lead to DDPM, and the SDE paper shows they are one family of models. Latent diffusion then made it cheap enough for large images.";
const MENTION = "Denoising Diffusion Probabilistic Models";
const PROMPT_TWO = "what does this build on, and what cites it?";
const ANSWER_TWO =
  "DDPM builds on Sohl-Dickstein's diffusion framework and on denoising score matching. Among the papers citing it, DDIM cuts sampling to a few dozen steps, Improved DDPM learns the variances, and Dhariwal and Nichol use both to beat GANs on ImageNet.";
const TITLE = "Diffusion models: origins";
const DESCRIPTION = "How diffusion models grew out of score matching and nonequilibrium thermodynamics, and what came after DDPM.";

// The script, in order; each phase lasts this many ms.
const PHASES = {
  typeOne: 2000,
  thinkOne: 800,
  searchOne: 1000,
  refsOne: 900,
  detailsOne: 900,
  placeOne: 1300,
  linkOne: 1100,
  noteOne: 1000,
  answerOne: 2600,
  restOne: 1100,
  openTab: 800,
  typeTwo: 1800,
  thinkTwo: 700,
  refsTwo: 1000,
  citingTwo: 1000,
  placeTwo: 1500,
  answerTwo: 2600,
  hold: 3600,
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

// Real papers, with the opening lines of their real abstracts. Older work on the left.
const FIRST_PAPERS: TimelineNode[] = [
  paperNode(1, 60, 120, 2011, "A Connection Between Score Matching and Denoising Autoencoders",
    "Denoising autoencoders have been previously shown to be competitive alternatives to restricted Boltzmann machines for unsupervised pretraining.",
    ["Pascal Vincent"]),
  paperNode(2, 60, 400, 2015, "Deep Unsupervised Learning using Nonequilibrium Thermodynamics",
    "A central problem in machine learning involves modeling complex data-sets using highly flexible families of probability distributions.",
    ["Jascha Sohl-Dickstein", "Eric Weiss", "Niru Maheswaranathan", "Surya Ganguli"]),
  paperNode(3, 476, 120, 2019, "Generative Modeling by Estimating Gradients of the Data Distribution",
    "We introduce a new generative model where samples are produced via Langevin dynamics using gradients of the data distribution estimated with score matching.",
    ["Yang Song", "Stefano Ermon"]),
  paperNode(4, 476, 400, 2020, MENTION,
    "We present high quality image synthesis results using diffusion probabilistic models, a class of latent variable models inspired by nonequilibrium thermodynamics.",
    ["Jonathan Ho", "Ajay Jain", "Pieter Abbeel"]),
  paperNode(5, 892, 120, 2021, "Score-Based Generative Modeling through Stochastic Differential Equations",
    "Creating noise from data is easy; creating data from noise is generative modeling.",
    ["Yang Song", "Jascha Sohl-Dickstein", "Diederik P. Kingma", "Abhishek Kumar", "Stefano Ermon", "Ben Poole"]),
  paperNode(6, 892, 400, 2022, "High-Resolution Image Synthesis with Latent Diffusion Models",
    "By decomposing the image formation process into a sequential application of denoising autoencoders, diffusion models achieve state-of-the-art synthesis results.",
    ["Robin Rombach", "Andreas Blattmann", "Dominik Lorenz", "Patrick Esser", "Björn Ommer"]),
];
const SECOND_PAPERS: TimelineNode[] = [
  paperNode(7, 892, 680, 2020, "Denoising Diffusion Implicit Models",
    "Denoising diffusion probabilistic models have achieved high quality image generation without adversarial training, yet they require simulating a Markov chain for many steps.",
    ["Jiaming Song", "Chenlin Meng", "Stefano Ermon"]),
  paperNode(8, 1308, 680, 2021, "Improved Denoising Diffusion Probabilistic Models",
    "Denoising diffusion probabilistic models are a class of generative models which have recently been shown to produce excellent samples.",
    ["Alex Nichol", "Prafulla Dhariwal"]),
  paperNode(9, 1308, 400, 2021, "Diffusion Models Beat GANs on Image Synthesis",
    "We show that diffusion models can achieve image sample quality superior to the current state-of-the-art generative models.",
    ["Prafulla Dhariwal", "Alex Nichol"]),
];
const FIRST_LINKS: [number, number][] = [[1, 3], [2, 4], [3, 5], [4, 5], [4, 6]];
const SECOND_LINKS: [number, number][] = [[4, 7], [7, 8], [7, 9]];
const CLUSTER = { label: "Score matching", members: [1, 3] };
const NOTE: TimelineNote = {
  id: "demo-note",
  kind: "question",
  color: "amber",
  text: "Open: why does sampling still take so many steps, and does distillation close the gap without losing quality?",
  x: 60,
  y: 680,
  width: 300,
  height: 150,
};

const noop = () => {};
const EMPTY_TIMELINE = { nodes: {}, adjacency: {}, lanes: 1, rootId: 1, expansions: [] } as TimelineData;

type Camera = { x: number; y: number; zoom: number };

/** The camera that fits these cards and notes into the free part of the canvas, like the fit button. */
function fitCamera(nodes: TimelineNode[], notes: TimelineNote[]): Camera {
  const boxes = [
    ...nodes.map((node) => ({ x: node.x, y: node.y - 64, right: node.x + NODE_DIMENSIONS.width, bottom: node.y + NODE_DIMENSIONS.height })),
    ...notes.map((note) => ({ x: note.x, y: note.y, right: note.x + (note.width ?? 300), bottom: note.y + (note.height ?? 150) })),
  ];
  const minX = Math.min(...boxes.map((box) => box.x)) - 24;
  const minY = Math.min(...boxes.map((box) => box.y));
  const maxX = Math.max(...boxes.map((box) => box.right)) + 24;
  const maxY = Math.max(...boxes.map((box) => box.bottom));
  const areaWidth = FIT_AREA.right - FIT_AREA.left;
  const areaHeight = FIT_AREA.bottom - FIT_AREA.top;
  const zoom = Math.min(areaWidth / (maxX - minX), areaHeight / (maxY - minY), 1);
  return {
    zoom,
    x: FIT_AREA.left + (areaWidth - (maxX - minX) * zoom) / 2 - minX * zoom,
    y: FIT_AREA.top + (areaHeight - (maxY - minY) * zoom) / 2 - minY * zoom,
  };
}
const FIRST_CAMERA = fitCamera(FIRST_PAPERS, [NOTE]);
const SECOND_CAMERA = fitCamera([...FIRST_PAPERS, ...SECOND_PAPERS], [NOTE]);

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
  const [scale, setScale] = useState(0.76);
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

function MentionChip({ children }: { children: ReactNode }) {
  return <span className={styles.mention}>{children}</span>;
}

export function LandingDemo() {
  const frameRef = useRef<HTMLDivElement>(null);
  const time = useDemoClock(frameRef);
  const scale = useFitScale(frameRef);

  const reached = (phase: Phase) => time >= STARTS[phase];
  const progress = (phase: Phase) => Math.min(Math.max((time - STARTS[phase]) / PHASES[phase], 0), 1);
  const finished = (phase: Phase) => time >= STARTS[phase] + PHASES[phase] * 0.7;
  const typedOf = (text: string, phase: Phase) => text.slice(0, Math.round(text.length * Math.min(progress(phase) * 1.15, 1)));
  // Each loop restarts the scene, so the entrance animations play again.
  const loop = Math.floor(time / LOOP);

  // Chats.
  const secondChat = reached("openTab");
  const sentOne = reached("thinkOne");
  const sentTwo = reached("thinkTwo");
  const busy = (sentOne && !reached("answerOne")) || (sentTwo && !reached("answerTwo"));

  // Canvas.
  const firstShown = reached("placeOne") ? Math.min(Math.ceil(progress("placeOne") * FIRST_PAPERS.length * 1.5), FIRST_PAPERS.length) : 0;
  const secondShown = reached("placeTwo") ? Math.min(Math.ceil(progress("placeTwo") * SECOND_PAPERS.length * 1.5), SECOND_PAPERS.length) : 0;
  const nodes = [...FIRST_PAPERS.slice(0, firstShown), ...SECOND_PAPERS.slice(0, secondShown)].map((node) =>
    reached("linkOne") && CLUSTER.members.includes(node.id) ? { ...node, group: CLUSTER.label } : node,
  );
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const regions = computeGroupRegions(nodes);
  const links = [...(reached("linkOne") ? FIRST_LINKS : []), ...(reached("placeTwo") ? SECOND_LINKS : [])];
  const noted = reached("noteOne");
  const mentioned = reached("typeTwo") && !reached("hold");
  const camera = reached("placeTwo") ? SECOND_CAMERA : FIRST_CAMERA;
  const named = finished("detailsOne");

  // History: each agent turn that changed the canvas is one undo step.
  const undoItems = [
    ...(reached("linkOne") ? [{ id: 1, label: "Agent: 6 papers, 5 links, 1 cluster", steps: 1 }] : []),
    ...(noted ? [{ id: 2, label: "Agent: note", steps: 2 }] : []),
    ...(reached("placeTwo") ? [{ id: 3, label: "Agent: 3 papers, 3 links", steps: 3 }] : []),
  ].reverse();

  // Minimap, following the camera.
  const viewListeners = useRef(new Set<() => void>());
  const cameraRef = useRef(camera);
  useEffect(() => {
    cameraRef.current = camera;
    viewListeners.current.forEach((listener) => listener());
  }, [camera]);
  const subscribe = useCallback((listener: () => void) => {
    viewListeners.current.add(listener);
    return () => { viewListeners.current.delete(listener); };
  }, []);
  const getView = useCallback((): MinimapView => {
    const { x, y, zoom } = cameraRef.current;
    return { x: -x / zoom, y: -y / zoom, width: CANVAS.width / zoom, height: CANVAS.height / zoom };
  }, []);
  const minimapItems: MinimapItem[] = [
    ...regions.map((region) => ({ id: `group-${region.key}`, kind: "group" as const, ...regionFrame(region) })),
    ...nodes.map((node) => ({ id: `node-${node.id}`, kind: "card" as const, x: node.x, y: node.y, width: NODE_DIMENSIONS.width, height: NODE_DIMENSIONS.height })),
    ...(noted ? [{ id: "note", kind: "note" as const, x: NOTE.x, y: NOTE.y, width: NOTE.width ?? 300, height: NOTE.height ?? 150 }] : []),
  ];

  // Agent thread for the open chat.
  const tools: ToolLine[] = [];
  const tool = (key: string, phase: Phase, running: string, done: string) => {
    if (reached(phase)) tools.push({ key, label: finished(phase) ? done : running, done: finished(phase) });
  };
  if (!secondChat) {
    tool("search", "searchOne", "Searching OpenAlex", "Searched OpenAlex · 24 candidates");
    tool("refs", "refsOne", "Reading references", "Read references · 6 papers");
    tool("details", "detailsOne", "Naming the canvas", "Named and described the canvas");
    if (reached("placeOne")) tools.push({ key: "canvas", label: reached("linkOne") ? "Canvas updated · 6 added, 5 linked, 1 cluster set" : "Updating canvas", done: finished("linkOne") });
    tool("note", "noteOne", "Creating canvas notes", "Created 1 canvas note");
  } else {
    tool("refs", "refsTwo", "Reading references", "Read references · 34 papers");
    tool("citing", "citingTwo", "Finding citing papers", "Found 40 citing papers");
    tool("canvas", "placeTwo", "Updating canvas", "Canvas updated · 3 added, 3 linked");
  }
  const thinking = secondChat ? sentTwo && !reached("refsTwo") : sentOne && !reached("searchOne");
  const answer = secondChat
    ? ANSWER_TWO.slice(0, Math.round(ANSWER_TWO.length * progress("answerTwo")))
    : ANSWER_ONE.slice(0, Math.round(ANSWER_ONE.length * progress("answerOne")));
  const question: ReactNode = secondChat
    ? sentTwo && <><MentionChip>@{MENTION}</MentionChip> {PROMPT_TWO}</>
    : sentOne && PROMPT_ONE;
  const draft: ReactNode = secondChat
    ? !sentTwo && reached("typeTwo") && <><MentionChip>@{MENTION}</MentionChip> {typedOf(PROMPT_TWO, "typeTwo")}</>
    : !sentOne && typedOf(PROMPT_ONE, "typeOne");

  const fading = time > LOOP - 450;

  return (
    <div ref={frameRef} className={styles.frame} style={{ height: APP.height * scale }}>
      <p className={styles.srOnly}>
        A sped-up demo of Sediment. Asked how diffusion models came out of score matching, the agent searches OpenAlex,
        names the canvas, places six papers from 2011 to 2022, links their citations, groups two into a cluster and
        leaves a note. In a second chat it traces what the DDPM paper builds on and what cites it, and adds three papers.
      </p>
      <div
        className={`canvas-shell ${styles.app}`}
        data-fading={fading || undefined}
        aria-hidden="true"
        inert
        style={{ width: APP.width, height: APP.height, transform: `scale(${scale})` }}
      >
        <AppHeader
          timelineData={EMPTY_TIMELINE}
          mobile={false}
          searchedQuery=""
          graphTitle={named ? TITLE : "New canvas"}
          graphDescription={named ? DESCRIPTION : ""}
          onSaveGraphDescription={noop}
          graphTitleDraft=""
          isEditingGraphTitle={false}
          canEditGraphTitle
          graphTitleInputRef={{ current: null }}
          mobileMenuOpen={false}
          globalChatOpen
          credits={reached("answerTwo") ? 7 : reached("answerOne") ? 8 : 9}
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
          <div className={styles.world} style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})` }}>
            {regions.map((region) => (
              <m.div key={`${loop}-${region.key}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}>
                <CanvasGroupRegion label={region.label} count={region.count} frame={regionFrame(region)} />
              </m.div>
            ))}

            <svg className={styles.edges} width={1800} height={1000}>
              <defs>
                <marker id="arrow-default" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto" markerUnits="strokeWidth">
                  <path d="M0,0 L0,6 L8,3 z" fill="var(--edge-color)" opacity="0.7" />
                </marker>
              </defs>
              {links.map(([from, to], index) => {
                const a = byId.get(from);
                const b = byId.get(to);
                return a && b ? <TimelineEdgeLine key={`${loop}-${from}-${to}`} from={a} to={b} index={index % 5} isActive={false} /> : null;
              })}
              {noted && byId.get(4) && (
                <TimelineNoteEdgeLine key={`${loop}-note`} note={NOTE} node={byId.get(4)!} edge={{ noteId: NOTE.id, nodeId: 4 }} index={0} />
              )}
            </svg>

            {nodes.map((node, index) => (
              <TimelineNodeCard
                key={`${loop}-${node.id}`}
                node={node}
                index={index}
                onClick={noop}
                isActive={false}
                isMentioned={mentioned && node.id === 4}
                shouldAnimate
              />
            ))}

            {noted && (
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
            <span className={styles.zoom}>{Math.round(camera.zoom * 100)}%</span>
            <div style={{ marginLeft: "0.25rem" }}>
              <CanvasHistory undoItems={undoItems} redoItems={[]} onUndo={noop} onRedo={noop} />
            </div>
            <span className={styles.toggle}>
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 8s3-5 7-5 7 5 7 5-3 5-7 5-7-5-7-5z" /><circle cx="8" cy="8" r="2" /><path d="M2 2l12 12" />
              </svg>
            </span>
            <span className={`${styles.toggle} ${styles.toggleOn}`}>
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <rect x="1.5" y="3" width="13" height="10" rx="2" /><rect x="8" y="7" width="4.5" height="3.5" rx="0.75" />
              </svg>
            </span>
          </div>

          {nodes.length > 0 && (
            <CanvasMinimap items={minimapItems} getView={getView} subscribe={subscribe} onNavigate={noop} right="1rem" />
          )}

          <aside className={styles.panel} style={{ width: PANEL_WIDTH }}>
            <ChatTabs
              tabs={[{ id: "one", title: "Diffusion origins" }, ...(secondChat ? [{ id: "two", title: reached("thinkTwo") ? "DDPM lineage" : null }] : [])]}
              activeId={secondChat ? "two" : "one"}
              busyIds={busy ? new Set([secondChat ? "two" : "one"]) : new Set()}
              canAdd
              onSelect={noop}
              onAdd={noop}
              onClose={noop}
              onClosePanel={noop}
              idPrefix="landing-demo"
            />
            <div className={styles.thread} key={secondChat ? "two" : "one"}>
              {question && (
                <div className={styles.userRow}>
                  <div className={styles.userBubble}>{question}</div>
                </div>
              )}
              {(tools.length > 0 || answer) && (
                <div className={styles.assistantRow}>
                  {answer && <div className={styles.answer}>{answer}</div>}
                  <div className={styles.tools}>
                    {tools.map((line) => (
                      <div key={line.key} className={styles.tool}>
                        <span style={{ color: line.done ? "var(--text-tertiary)" : "var(--accent)" }}>{line.done ? "✓" : "↻"}</span>
                        {line.label}
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
                <span className={draft ? styles.composerText : styles.composerPlaceholder}>
                  {draft || "Ask anything, @ to mention a paper"}
                </span>
                <span className={styles.send} data-ready={draft ? "" : undefined}>
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
