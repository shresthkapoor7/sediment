"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { LogoMark } from "@/components/LogoMark";
import styles from "./LandingDemo.module.css";

/*
 * A looping, scripted picture of one agent turn on the home page: a question goes in, the agent searches,
 * places papers by year, links them, groups two, leaves a note and answers. Nothing here calls the backend.
 * Every frame is derived from one clock, so pausing it (off screen, or reduced motion) freezes the scene.
 */

const PROMPT = "Map how diffusion models came out of score matching, and note what's still open.";
const ANSWER =
  "Two lines meet here. Score matching (Vincent, then Song and Ermon) and the thermodynamic view (Sohl-Dickstein) both lead to DDPM, and the SDE paper shows they describe the same model. Latent diffusion then made it cheap enough for large images.";

// Phase lengths in ms, in order.
const PHASES = {
  typing: 2400,
  sending: 1100,
  search: 1500,
  place: 1500,
  link: 1400,
  group: 1100,
  note: 1100,
  answer: 3400,
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

// Positions are percentages of the canvas; papers sit in year columns, older on the left.
const PAPERS = [
  { id: "vincent", year: 2011, title: "A Connection Between Score Matching and Denoising Autoencoders", authors: "P. Vincent", x: 3, y: 8 },
  { id: "sohl", year: 2015, title: "Deep Unsupervised Learning using Nonequilibrium Thermodynamics", authors: "J. Sohl-Dickstein, E. Weiss, N. Maheswaranathan, S. Ganguli", x: 3, y: 47 },
  { id: "ermon", year: 2019, title: "Generative Modeling by Estimating Gradients of the Data Distribution", authors: "Y. Song, S. Ermon", x: 37, y: 8 },
  { id: "ddpm", year: 2020, title: "Denoising Diffusion Probabilistic Models", authors: "J. Ho, A. Jain, P. Abbeel", x: 37, y: 47 },
  { id: "sde", year: 2021, title: "Score-Based Generative Modeling through Stochastic Differential Equations", authors: "Y. Song, J. Sohl-Dickstein, D. Kingma, A. Kumar, S. Ermon, B. Poole", x: 71, y: 8 },
  { id: "ldm", year: 2022, title: "High-Resolution Image Synthesis with Latent Diffusion Models", authors: "R. Rombach, A. Blattmann, D. Lorenz, P. Esser, B. Ommer", x: 71, y: 47 },
] as const;
const CARD = { w: 26, h: 30 };
const LINKS: [string, string][] = [["vincent", "ermon"], ["sohl", "ddpm"], ["ermon", "sde"], ["ddpm", "sde"], ["ddpm", "ldm"]];

const STEPS: { phase: Phase; label: string; detail: string }[] = [
  { phase: "search", label: "Searched OpenAlex", detail: "score matching, diffusion probabilistic models" },
  { phase: "place", label: "Placed 6 papers", detail: "by year, 2011 to 2022" },
  { phase: "link", label: "Linked 5 citations", detail: "from their reference lists" },
  { phase: "group", label: "Grouped 2 papers", detail: "Score matching" },
  { phase: "note", label: "Left a note", detail: "on the open question" },
];

function useDemoClock(root: React.RefObject<HTMLElement | null>) {
  const [time, setTime] = useState(0);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduced.matches) {
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

export function LandingDemo() {
  const rootRef = useRef<HTMLDivElement>(null);
  const time = useDemoClock(rootRef);

  const reached = (phase: Phase) => time >= STARTS[phase];
  const progress = (phase: Phase) => Math.min(Math.max((time - STARTS[phase]) / PHASES[phase], 0), 1);

  const typed = reached("sending") ? "" : PROMPT.slice(0, Math.round(PROMPT.length * Math.min(progress("typing") * 1.15, 1)));
  const sent = reached("sending");
  const working = sent && !reached("answer");
  const answer = ANSWER.slice(0, Math.round(ANSWER.length * progress("answer")));
  // The first three papers arrive with the search, the rest when they are placed.
  const papersShown = reached("place") ? Math.min(3 + Math.ceil(progress("place") * 3 * 1.4), 6) : reached("search") ? Math.min(Math.ceil(progress("search") * 3 * 1.4), 3) : 0;
  const linksDrawn = reached("link");
  const clustered = reached("group");
  const noted = reached("note");
  const seconds = Math.max(1, Math.round(((reached("answer") ? STARTS.answer : time) - STARTS.sending) / 1000));
  // Fade the scene out at the end of the loop so the restart doesn't jump.
  const fading = time > LOOP - 500;

  const byId = Object.fromEntries(PAPERS.map((paper) => [paper.id, paper]));

  return (
    <div ref={rootRef} className={styles.window} data-fading={fading || undefined} aria-label="Demo: the agent maps a research question onto a canvas" role="img">
      <div className={styles.titlebar}>
        <LogoMark width="16" height="16" />
        <span className={styles.crumb}>Sediment</span>
        <span className={styles.slash}>/</span>
        <span className={styles.canvasTitle}>Diffusion models: origins</span>
        <span className={styles.titlebarSpacer} />
        <span className={styles.ring} style={{ "--credit-progress": "70%" } as CSSProperties} />
        <span className={styles.pill}>Export</span>
        <span className={`${styles.pill} ${styles.pillActive}`}>Agent</span>
      </div>

      <div className={styles.body}>
        <div className={styles.canvas}>
          <svg className={styles.links} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {LINKS.map(([from, to], index) => {
              const a = byId[from];
              const b = byId[to];
              const x1 = a.x + CARD.w;
              const y1 = a.y + CARD.h / 2;
              const x2 = b.x;
              const y2 = b.y + CARD.h / 2;
              const mid = (x1 + x2) / 2;
              return (
                <path
                  key={`${from}-${to}`}
                  d={`M${x1} ${y1} C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`}
                  pathLength={1}
                  className={styles.link}
                  data-drawn={linksDrawn || undefined}
                  style={{ transitionDelay: `${index * 140}ms` }}
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
          </svg>

          <div
            className={styles.cluster}
            data-shown={clustered || undefined}
            style={{ left: "1.5%", top: "2%", width: `${byId.ermon.x + CARD.w}%`, height: `${CARD.h + 9}%` }}
          >
            <span>Score matching</span>
          </div>

          {PAPERS.map((paper, index) => (
            <div
              key={paper.id}
              className={styles.card}
              data-shown={index < papersShown || undefined}
              data-tint={clustered && (paper.id === "vincent" || paper.id === "ermon") ? "" : undefined}
              style={{ left: `${paper.x}%`, top: `${paper.y}%`, width: `${CARD.w}%`, height: `${CARD.h}%` }}
            >
              <div className={styles.meta}>
                <span className={styles.year}>{paper.year}</span>
              </div>
              <div className={styles.title}>{paper.title}</div>
              <div className={styles.authors}>{paper.authors}</div>
            </div>
          ))}

          <div className={styles.note} data-shown={noted || undefined} style={{ left: "37%", top: "83%", width: "40%" }}>
            Open: why do samplers need so many steps, and does distillation close the gap?
          </div>

          <div className={styles.toolbar} aria-hidden="true">
            <span className={styles.toolbarAdd}>+ Add paper</span>
            <span>−</span>
            <span>+</span>
            <span>⌂</span>
            <span className={styles.zoom}>100%</span>
          </div>
        </div>

        <aside className={styles.agent}>
          <div className={styles.thread}>
            {sent && <div className={styles.question}>{PROMPT}</div>}
            {sent && (
              <div className={styles.worked}>
                {working ? <span className={styles.spinner} /> : null}
                <span>{working ? "Working" : "Worked"} for {seconds}s</span>
              </div>
            )}
            {sent && (
              <ul className={styles.steps}>
                {STEPS.filter((step) => reached(step.phase)).map((step) => (
                  <li key={step.label} className={styles.step}>
                    <span className={styles.stepDot} data-done={time >= STARTS[step.phase] + PHASES[step.phase] * 0.6 || undefined} />
                    <span className={styles.stepLabel}>{step.label}</span>
                    <span className={styles.stepDetail}>{step.detail}</span>
                  </li>
                ))}
              </ul>
            )}
            {answer && <p className={styles.answer}>{answer}{progress("answer") < 1 && <span className={styles.caret} />}</p>}
          </div>
          <div className={styles.composer}>
            <span className={typed ? styles.composerText : styles.composerPlaceholder}>
              {typed || "Ask the agent about this canvas. @ to mention a paper"}
              {!sent && typed && <span className={styles.caret} />}
            </span>
            <span className={styles.send} data-ready={(!!typed && !sent) || undefined}>↑</span>
          </div>
        </aside>
      </div>
    </div>
  );
}
