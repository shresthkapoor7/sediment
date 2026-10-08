"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { FeedPaper } from "@/lib/feeds-api";
import { PaperMentionInput, mentionedPapers } from "./PaperMentionInput";
import { LogoMark } from "@/components/LogoMark";
import { FeedPaperImage } from "./FeedPaperImage";
import styles from "./PaperStage.module.css";

export function PaperStage({ papers, onRemove, onClear, onOpen }: {
  papers: FeedPaper[];
  onRemove: (paper: FeedPaper) => void;
  onClear: () => void;
  onOpen: (paper: FeedPaper) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [stackAnchor, setStackAnchor] = useState(0);
  const [gathering, setGathering] = useState(false);
  const [chatMode, setChatMode] = useState(false);
  const [messages, setMessages] = useState<{ text: string; paper: string; paperIds: string[] }[]>([]);
  const chatLog = useRef<HTMLDivElement>(null);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [chatScrolling, setChatScrolling] = useState(false);
  useEffect(() => () => { if (scrollTimer.current) clearTimeout(scrollTimer.current); }, []);
  const [closing, setClosing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const activeIndex = Math.max(0, papers.findIndex(paper => paper.id === activeId));
  const activePaper = papers[activeIndex];
  const draft = activePaper ? drafts[activePaper.id] || "" : "";
  const references = mentionedPapers(draft, papers);
  const highlightedIds = draft.trim() ? references.map(paper => paper.id) : messages.at(-1)?.paperIds || [];
  function askAgent(event: React.FormEvent) {
    event.preventDefault();
    const text = activePaper && drafts[activePaper.id]?.trim();
    if (!text || !activePaper) return;
    const targets = references.length ? references : [activePaper];
    setMessages(current => [...current, { text, paper: targets.map(paper => paper.title).join(" · "), paperIds: targets.map(paper => paper.id) }]);
    setDrafts(current => ({ ...current, [activePaper.id]: "" }));
    if (!chatMode) { setStackAnchor(activeIndex); setGathering(!window.matchMedia("(prefers-reduced-motion: reduce)").matches); }
    setChatMode(true);
  }
  useEffect(() => {
    if (chatLog.current) chatLog.current.scrollTop = chatLog.current.scrollHeight;
  }, [messages]);
  function focusPaper(index: number, smooth = true) {
    const paper = papers[index];
    const scroller = viewport.current;
    const cards = scroller?.querySelectorAll<HTMLElement>("article");
    if (!paper || !scroller || !cards?.[index]) return;
    setActiveId(paper.id);
    scroller.scrollTo({ left: cards[index].offsetLeft - cards[0].offsetLeft, behavior: smooth && !window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "smooth" : "instant" });
  }
  function move(direction: number) { focusPaper(activeIndex + direction); }
  const [origin, setOrigin] = useState<CSSProperties>({});

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function expand() {
    const rect = trigger.current?.getBoundingClientRect();
    if (rect) setOrigin({ "--stage-x": `${rect.left + rect.width / 2 - window.innerWidth / 2}px`, "--stage-y": `${rect.top + rect.height / 2 - window.innerHeight / 2}px` } as CSSProperties);
    setClosing(false);
    setExpanded(true);
    dialog.current?.showModal();
    if (!chatMode) requestAnimationFrame(() => focusPaper(activeIndex, false));
  }

  function minimize(after?: () => void) {
    if (timer.current) return;
    // Gather from the current visual positions, including a mid-scroll dismissal.
    viewport.current?.querySelectorAll<HTMLElement>("article").forEach((card, index) => {
      const rect = card.getBoundingClientRect();
      card.style.setProperty("--gather-x", `${window.innerWidth / 2 - rect.left - rect.width / 2 + (index - activeIndex) * 5}px`);
    });
    setClosing(true);
    timer.current = setTimeout(() => {
      dialog.current?.close();
      setExpanded(false);
      setClosing(false);
      timer.current = null;
      trigger.current?.focus();
      after?.();
    }, window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 640);
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
    <dialog ref={dialog} className={styles.dialog} style={origin} data-closing={closing || undefined} data-chat={chatMode || undefined} data-gathering={gathering || undefined} aria-labelledby="marked-papers-title" onKeyDown={event => {
      if (chatMode) return;
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
        <div className={styles.carousel}>
        {chatMode && activePaper && <span className={styles.stackCount} role="status" aria-live="polite" aria-label={`Paper ${activeIndex + 1} of ${papers.length}`}>{activeIndex + 1} / {papers.length}</span>}
        <div ref={viewport} className={styles.viewport} onScroll={() => {
          if (chatMode) return;
          const scroller = viewport.current;
          const cards = scroller?.querySelectorAll<HTMLElement>("article");
          if (!scroller || !cards?.length) return;
          let nearest = 0;
          cards.forEach((card, index) => { if (Math.abs(card.offsetLeft - cards[0].offsetLeft - scroller.scrollLeft) < Math.abs(cards[nearest].offsetLeft - cards[0].offsetLeft - scroller.scrollLeft)) nearest = index; });
          if (papers[nearest]) setActiveId(papers[nearest].id);
        }}>
        <div className={styles.papers}>
          {papers.map((paper, index) => <article key={paper.id} className={styles.paper} onAnimationEnd={event => { if (event.target === event.currentTarget && gathering && chatMode) setGathering(false); }} data-mentioned={highlightedIds.includes(paper.id) || undefined} data-active={index === activeIndex} style={{ "--pile-index": index - activeIndex, "--stack-offset": stackAnchor - index, "--stack-depth": (index - activeIndex + papers.length) % papers.length, zIndex: chatMode ? papers.length - (index - activeIndex + papers.length) % papers.length : papers.length - Math.abs(index - activeIndex) } as CSSProperties} aria-label={paper.title} inert={chatMode && index !== activeIndex} onFocus={() => { if (!chatMode) focusPaper(index); }} onClick={() => { if (!chatMode) focusPaper(index); }}>
            {chatMode && index === activeIndex && papers.length > 1 && <button type="button" className={styles.cycleCard} disabled={gathering} aria-label="Next paper in stack" onClick={event => {
              event.stopPropagation();
              setActiveId(papers[(activeIndex + 1) % papers.length].id);
              requestAnimationFrame(() => dialog.current?.querySelector<HTMLButtonElement>(`button[aria-label="Next paper in stack"]`)?.focus({ preventScroll: true }));
            }} />}
            {highlightedIds.includes(paper.id) && <span className={styles.mentionBadge}>Mentioned</span>}
            <FeedPaperImage paper={paper} className={styles.figure} />
            <div className={styles.paperBody}>
              <span className={styles.topic}>{paper.topics[0] || "Research paper"}</span>
              <h3><button onClick={() => focusPaper(index)}>{paper.title}</button></h3>
              <p className={styles.authors}>{paper.authors.slice(0, 3).join(", ")}</p>
              <p className={styles.abstract}>{paper.abstract || "Open this paper for its source and details."}</p>
              <div className={styles.paperActions}><button onClick={() => minimize(() => onOpen(paper))} className={styles.openPaper}><span>Open paper</span><svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 8L8 2M8 2H3.5M8 2V6.5" /></svg></button><button onClick={event => { event.stopPropagation(); if (paper.id === activePaper?.id) setActiveId((papers[index + 1] || papers[index - 1])?.id || null); onRemove(paper); }} aria-label={`Unmark ${paper.title}`}>Unmark</button></div>
            </div>
          </article>)}
        </div>
        </div>
        {activePaper && <nav className={styles.navigation} aria-label="Browse marked papers">
            <button aria-label="Previous paper" disabled={activeIndex === 0} onClick={() => move(-1)}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m14 6-6 6 6 6" /></svg></button>
            <span className={styles.srOnly} role="status" aria-live="polite">{activeIndex + 1} / {papers.length}<span className={styles.srOnly}>: {activePaper.title}</span></span>
            <button aria-label="Next paper" disabled={activeIndex === papers.length - 1} onClick={() => move(1)}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m10 6 6 6-6 6" /></svg></button>
          </nav>}
        </div>
        {chatMode && <section className={styles.chat} aria-label="Feeds agent conversation">
          <div className={styles.chatHeading}><div><LogoMark width="20" height="20" /><h2>Feeds agent</h2></div><button type="button" onClick={() => { setChatMode(false); setGathering(false); requestAnimationFrame(() => focusPaper(activeIndex, false)); }}>Back to papers</button></div>
          <div ref={chatLog} className={styles.chatLog} data-scrolling={chatScrolling || undefined} onScroll={() => {
            setChatScrolling(true);
            if (scrollTimer.current) clearTimeout(scrollTimer.current);
            scrollTimer.current = setTimeout(() => setChatScrolling(false), 800);
          }} role="log" aria-live="polite" aria-label="Your messages">
            {messages.map((message, index) => <div key={index} className={styles.message}><span>{message.paper}</span><p>{message.text}</p></div>)}
          </div>
        </section>}
        {activePaper ? <form className={styles.composer} onSubmit={askAgent}>
            <span className={styles.agentLogo} aria-hidden="true"><LogoMark width="20" height="20" /></span>
            <PaperMentionInput papers={papers} value={draft} onChange={value => setDrafts(current => ({ ...current, [activePaper.id]: value }))} />
            <button className={styles.send} type="submit" aria-label="Send message" disabled={!drafts[activePaper.id]?.trim()}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6" /></svg></button>
          </form> : <p className={styles.empty}>No marked papers. Mark a paper beside Save to collect it here.</p>}
      </div>
    </dialog>
  </>;
}
