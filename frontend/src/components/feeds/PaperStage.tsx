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
    <dialog ref={dialog} className={styles.dialog} style={origin} data-closing={closing || undefined} aria-labelledby="marked-papers-title" onCancel={event => { event.preventDefault(); minimize(); }} onClick={event => { if (event.target === event.currentTarget) minimize(); }}>
      <div className={styles.surface}>
        <header className={styles.header}>
          <div><h2 id="marked-papers-title">Marked papers <span>{papers.length}</span></h2><p>A collection for this visit.</p></div>
          <div className={styles.actions}>
            {papers.length > 0 && <button onClick={() => minimize(onClear)}>Clear marks</button>}
            <button autoFocus onClick={() => minimize()} aria-label="Minimize marked papers"><svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M4 9h10" /></svg></button>
          </div>
        </header>
        <div className={styles.papers}>
          {papers.map((paper, index) => <article key={paper.id} className={styles.paper} style={{ "--order": Math.min(index, 8) } as CSSProperties}>
            <FeedPaperImage paper={paper} className={styles.figure} />
            <div className={styles.paperBody}>
              <span className={styles.topic}>{paper.topics[0] || "Research paper"}</span>
              <h3><button onClick={() => minimize(() => onOpen(paper))}>{paper.title}</button></h3>
              <p className={styles.authors}>{paper.authors.slice(0, 3).join(", ")}</p>
              <p className={styles.abstract}>{paper.abstract || "Open this paper for its source and details."}</p>
              <div className={styles.paperActions}><button onClick={() => minimize(() => onOpen(paper))}>Open paper ↗</button><button onClick={() => onRemove(paper)} aria-label={`Unmark ${paper.title}`}>Unmark</button></div>
            </div>
          </article>)}
          {!papers.length && <p className={styles.empty}>No marked papers. Mark a paper beside Save to collect it here.</p>}
        </div>
      </div>
    </dialog>
  </>;
}
