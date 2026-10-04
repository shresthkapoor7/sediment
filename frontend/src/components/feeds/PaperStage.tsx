"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { FeedPaper } from "@/lib/feeds-api";
import { FeedPaperImage } from "./FeedPaperImage";
import styles from "./PaperStage.module.css";

export function PaperStage({ papers, onRemove, onClear, onOpen }: {
  papers: FeedPaper[];
  onRemove: (paper: FeedPaper) => void;
  onClear: () => void;
  onOpen: (paper: FeedPaper) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [closing, setClosing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const activeIndex = Math.max(0, papers.findIndex(paper => paper.id === activeId));
  const activePaper = papers[activeIndex];
  function move(direction: number) {
    const paper = papers[activeIndex + direction];
    if (paper) setActiveId(paper.id);
  }
  const [origin, setOrigin] = useState<CSSProperties>({});

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function expand() {
    const rect = trigger.current?.getBoundingClientRect();
    if (rect) setOrigin({ "--stage-x": `${rect.left + rect.width / 2 - window.innerWidth / 2}px`, "--stage-y": `${rect.top + rect.height / 2 - window.innerHeight / 2}px` } as CSSProperties);
    setClosing(false);
    setExpanded(true);
    dialog.current?.showModal();
  }

  function minimize(after?: () => void) {
    if (timer.current) return;
    setClosing(true);
    timer.current = setTimeout(() => {
      dialog.current?.close();
      setExpanded(false);
      setClosing(false);
      timer.current = null;
      trigger.current?.focus();
      after?.();
    }, window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 260);
  }

  return <>
    {(papers.length > 0 || expanded) && <button ref={trigger} className={styles.dock} onClick={expand} aria-label={`Open ${papers.length} marked papers`} aria-haspopup="dialog" aria-expanded={expanded}>
      <span className={styles.stack} aria-hidden="true">
        {papers.slice(-3).map((paper, index, shown) => <span className={styles.miniPaper} key={paper.id} style={{ "--sheet": index - shown.length + 1 } as CSSProperties}>
          <span>{paper.title}</span><i /><i /><i />
        </span>)}
      </span>
      <span className={styles.dockLabel}>Marked <span>{papers.length}</span></span>
    </button>}
    <dialog ref={dialog} className={styles.dialog} style={origin} data-closing={closing || undefined} aria-labelledby="marked-papers-title" onKeyDown={event => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") { event.preventDefault(); move(event.key === "ArrowRight" ? 1 : -1); }
    }} onCancel={event => { event.preventDefault(); minimize(); }} onClick={event => { if (event.target === event.currentTarget) minimize(); }}>
      <div className={styles.surface}>
        <header className={styles.header}>
          <div><h2 id="marked-papers-title">Marked papers <span>{papers.length}</span></h2><p>A collection for this visit.</p></div>
          <div className={styles.actions}>
            {papers.length > 0 && <button onClick={() => minimize(onClear)}>Clear marks</button>}
            <button autoFocus onClick={() => minimize()} aria-label="Minimize marked papers"><svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M4 9h10" /></svg></button>
          </div>
        </header>
        <div className={styles.viewport}>
        <div className={styles.papers} style={{ "--active": activeIndex } as CSSProperties}>
          {papers.map((paper, index) => <article key={paper.id} className={styles.paper} data-active={index === activeIndex} aria-label={paper.title} onFocus={() => setActiveId(paper.id)} onClick={() => setActiveId(paper.id)}>
            <FeedPaperImage paper={paper} className={styles.figure} />
            <div className={styles.paperBody}>
              <span className={styles.topic}>{paper.topics[0] || "Research paper"}</span>
              <h3><button onClick={() => setActiveId(paper.id)}>{paper.title}</button></h3>
              <p className={styles.authors}>{paper.authors.slice(0, 3).join(", ")}</p>
              <p className={styles.abstract}>{paper.abstract || "Open this paper for its source and details."}</p>
              <div className={styles.paperActions}><button onClick={() => minimize(() => onOpen(paper))}>Open paper ↗</button><button onClick={event => { event.stopPropagation(); if (paper.id === activePaper?.id) setActiveId((papers[index + 1] || papers[index - 1])?.id || null); onRemove(paper); }} aria-label={`Unmark ${paper.title}`}>Unmark</button></div>
            </div>
          </article>)}
        </div>
        </div>
        {activePaper ? <>
          <nav className={styles.navigation} aria-label="Browse marked papers">
            <button aria-label="Previous paper" disabled={activeIndex === 0} onClick={() => move(-1)}>←</button>
            <span role="status" aria-live="polite">{activeIndex + 1} / {papers.length}<span className={styles.srOnly}>: {activePaper.title}</span></span>
            <button aria-label="Next paper" disabled={activeIndex === papers.length - 1} onClick={() => move(1)}>→</button>
          </nav>
          <div className={styles.composer}>
            <label htmlFor="paper-question">Ask AI <span>about this paper</span></label>
            <input id="paper-question" placeholder="What would you like to know?" value={drafts[activePaper.id] || ""} onChange={event => setDrafts(current => ({ ...current, [activePaper.id]: event.target.value }))} aria-describedby="paper-question-note" />
            <span id="paper-question-note">AI answers coming next.</span>
          </div>
        </> : <p className={styles.empty}>No marked papers. Mark a paper beside Save to collect it here.</p>}
      </div>
    </dialog>
  </>;
}
