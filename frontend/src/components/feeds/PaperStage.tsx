"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { FeedPaper } from "@/lib/feeds-api";
import { PaperMentionInput, mentionedPapers } from "./PaperMentionInput";
import { LogoMark } from "@/components/LogoMark";
import { FeedPaperImage } from "./FeedPaperImage";
import { MarkdownContent } from "@/components/MarkdownContent";
import { streamFeedChat } from "@/lib/feed-chat-api";
import styles from "./PaperStage.module.css";

type StageMessage =
  | { role: "user"; text: string; paper: string; paperIds: string[] }
  | { role: "assistant"; text: string; pending: boolean; status?: string; offer?: boolean };

const TOOL_STATUS: Record<string, string> = {
  search_openalex_papers: "Searching OpenAlex",
  search_recent_papers: "Searching recent papers",
  mark_papers: "Marking papers",
  update_interests: "Updating your interests",
  offer_workspace: "Getting a workspace ready",
  web_search: "Searching the web",
};

export function PaperStage({ papers, onRemove, onClear, onOpen, feedPapers, interests, domain, onMark, onInterests, onStartWorkspace }: {
  papers: FeedPaper[];
  onRemove: (paper: FeedPaper) => void;
  onClear: () => void;
  onOpen: (paper: FeedPaper) => void;
  /** What the assistant sees besides the marked papers. */
  feedPapers: FeedPaper[];
  interests: string;
  domain: string;
  onMark: (papers: FeedPaper[]) => void;
  onInterests: (interests: string) => void;
  /** Start a workspace from the marked papers; offered by the assistant. */
  onStartWorkspace?: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [stackAnchor, setStackAnchor] = useState(0);
  const [gathering, setGathering] = useState(false);
  const [chatMode, setChatMode] = useState(false);
  const [messages, setMessages] = useState<StageMessage[]>([]);
  const [replying, setReplying] = useState(false);
  const reply = useRef<AbortController | null>(null);
  useEffect(() => () => reply.current?.abort(), []);
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
  const lastAsked = [...messages].reverse().find((message): message is Extract<StageMessage, { role: "user" }> => message.role === "user");
  const highlightedIds = draft.trim() ? references.map(paper => paper.id) : lastAsked?.paperIds || [];
  function updateReply(patch: (message: Extract<StageMessage, { role: "assistant" }>) => Partial<Extract<StageMessage, { role: "assistant" }>>) {
    setMessages(current => {
      const index = current.length - 1;
      const last = current[index];
      if (!last || last.role !== "assistant") return current;
      const next = [...current];
      next[index] = { ...last, ...patch(last) };
      return next;
    });
  }
  async function send(text: string, targets: FeedPaper[]) {
    const history = messages.flatMap(message => message.text.trim() ? [{ role: message.role, content: message.text }] : []);
    setMessages(current => [
      ...current,
      { role: "user", text, paper: targets.map(paper => paper.title).join(" · "), paperIds: targets.map(paper => paper.id) },
      { role: "assistant", text: "", pending: true, status: "Thinking" },
    ]);
    setReplying(true);
    const controller = new AbortController();
    reply.current = controller;
    try {
      await streamFeedChat({ question: text, interests, domain, feedPapers, markedPapers: papers, mentionedPaperIds: targets.map(paper => paper.id), history }, event => {
        if (event.type === "text_delta") updateReply(last => ({ text: last.text + event.text, status: undefined }));
        if (event.type === "tool_started") updateReply(() => ({ status: TOOL_STATUS[event.name] ?? "Working" }));
        if (event.type === "mark_papers") onMark(event.papers);
        if (event.type === "interests_change") onInterests(event.interests);
        if (event.type === "workspace_offer") updateReply(() => ({ offer: true }));
        if (event.type === "message_completed") updateReply(last => ({ text: last.text || event.response.text, pending: false, status: undefined }));
      }, controller.signal);
    } catch (error) {
      if (!controller.signal.aborted) updateReply(last => ({ text: last.text || (error instanceof Error ? error.message : "Chat failed."), pending: false, status: undefined }));
    } finally {
      updateReply(() => ({ pending: false, status: undefined }));
      setReplying(false);
    }
  }
  function askAgent(event: React.FormEvent) {
    event.preventDefault();
    const text = activePaper && drafts[activePaper.id]?.trim();
    if (!text || !activePaper || replying) return;
    const targets = references.length ? references : [activePaper];
    void send(text, targets);
    setDrafts(current => ({ ...current, [activePaper.id]: "" }));
    if (!chatMode) { setStackAnchor(activeIndex); setGathering(!window.matchMedia("(prefers-reduced-motion: reduce)").matches); }
    setChatMode(true);
  }
  useEffect(() => {
    if (chatLog.current) chatLog.current.scrollTop = chatLog.current.scrollHeight;
  }, [messages]);
  // An emptied collection ends the conversation; newly marked papers start fresh.
  if (!papers.length && !replying && (chatMode || gathering || stackAnchor || messages.length)) {
    setChatMode(false);
    setGathering(false);
    setStackAnchor(0);
    setMessages([]);
  }
  if (!papers.length && Object.keys(drafts).length) setDrafts({});
  function focusPaper(index: number, smooth = true) {
    const paper = papers[index];
    const scroller = viewport.current;
    const cards = scroller?.querySelectorAll<HTMLElement>("article");
    if (!paper || !scroller || !cards?.[index]) return;
    setActiveId(paper.id);
    scroller.scrollTo({ left: cards[index].offsetLeft - cards[0].offsetLeft, behavior: smooth && !window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "smooth" : "instant" });
  }
  function move(direction: number) { focusPaper(activeIndex + direction); }
  const focusFrame = useRef<number | null>(null);
  function syncFocusBlur() {
    focusFrame.current = null;
    const scroller = viewport.current;
    const cards = scroller ? Array.from(scroller.querySelectorAll<HTMLElement>("article")) : [];
    if (!scroller || !cards.length) return;
    // Read every position before writing so the loop does not force repeated layouts.
    const center = scroller.scrollLeft + scroller.clientWidth / 2;
    const step = cards.length > 1 ? cards[1].offsetLeft - cards[0].offsetLeft : cards[0].offsetWidth;
    const distances = cards.map(card => Math.min(1, Math.abs(card.offsetLeft + card.offsetWidth / 2 - center) / step));
    const nearest = cards.reduce((best, card, index) =>
      Math.abs(card.offsetLeft + card.offsetWidth / 2 - center) <
      Math.abs(cards[best].offsetLeft + cards[best].offsetWidth / 2 - center) ? index : best, 0);
    cards.forEach((card, index) => card.style.setProperty("--focus-distance", distances[index].toFixed(3)));
    if (papers[nearest]) setActiveId(current => current === papers[nearest].id ? current : papers[nearest].id);
  }
  function scheduleFocusBlur() {
    if (focusFrame.current === null) focusFrame.current = requestAnimationFrame(syncFocusBlur);
  }
  useEffect(() => { if (expanded && !chatMode) scheduleFocusBlur(); }, [expanded, chatMode, papers]);
  useEffect(() => () => { if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current); }, []);
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
    <dialog ref={dialog} className={styles.dialog} style={{ ...origin, "--stack-anchor": stackAnchor } as CSSProperties} data-closing={closing || undefined} data-chat={chatMode || undefined} data-gathering={gathering || undefined} aria-labelledby="marked-papers-title" onKeyDown={event => {
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
          scheduleFocusBlur();

        }}>
        <div className={styles.papers}>
          {papers.map((paper, index) => <article key={paper.id} className={styles.paper} onAnimationEnd={event => { if (event.target === event.currentTarget && gathering && chatMode) setGathering(false); }} data-mentioned={highlightedIds.includes(paper.id) || undefined} data-active={index === activeIndex} style={{ "--pile-index": index - activeIndex, "--stack-offset": stackAnchor - index, "--stack-depth": (index - activeIndex + papers.length) % papers.length, zIndex: chatMode ? papers.length - (index - activeIndex + papers.length) % papers.length : papers.length - Math.abs(index - activeIndex) } as CSSProperties} aria-label={paper.title} inert={chatMode && index !== activeIndex} onFocus={event => { if (!chatMode && !event.currentTarget.contains(event.relatedTarget as Node | null)) focusPaper(index); }} onClick={() => { if (!chatMode) focusPaper(index); }}>
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
        {chatMode && <section className={styles.chat} aria-label="Sediment conversation">
          <div className={styles.chatHeading}><div><LogoMark width="20" height="20" /><h2>Sediment</h2></div><button type="button" onClick={() => { setChatMode(false); setGathering(false); requestAnimationFrame(() => focusPaper(activeIndex, false)); }}>Back to papers</button></div>
          <div ref={chatLog} className={styles.chatLog} data-scrolling={chatScrolling || undefined} onScroll={() => {
            setChatScrolling(true);
            if (scrollTimer.current) clearTimeout(scrollTimer.current);
            scrollTimer.current = setTimeout(() => setChatScrolling(false), 800);
          }} role="log" aria-live="polite" aria-label="Your messages">
            {messages.map((message, index) => message.role === "user"
              ? <div key={index} className={styles.message}><span>{message.paper}</span><p>{message.text}</p></div>
              : <div key={index} className={styles.reply}>
                {message.text && <MarkdownContent>{message.text}</MarkdownContent>}
                {message.status && <p className={styles.replyStatus}>{message.status}…</p>}
                {message.offer && onStartWorkspace && papers.length > 0 && <button type="button" className={styles.offer} onClick={() => minimize(onStartWorkspace)}>
                  Start a workspace from {papers.length} marked {papers.length === 1 ? "paper" : "papers"}
                </button>}
              </div>)}
          </div>
        </section>}
        {activePaper ? <form className={styles.composer} onSubmit={askAgent}>
            <span className={styles.agentLogo} aria-hidden="true"><LogoMark width="20" height="20" /></span>
            <PaperMentionInput papers={papers} value={draft} onChange={value => setDrafts(current => ({ ...current, [activePaper.id]: value }))} />
            <button className={styles.send} type="submit" aria-label="Send message" disabled={!drafts[activePaper.id]?.trim() || replying}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6" /></svg></button>
          </form> : <p className={styles.empty}>No marked papers. Mark a paper beside Save to collect it here.</p>}
      </div>
    </dialog>
  </>;
}
