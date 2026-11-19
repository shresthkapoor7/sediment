"use client";

import { usePaperSelection } from "@/lib/paper-selection";
import { PaperSelectionControl } from "@/components/feeds/PaperSelectionControl";
import { PaperStage } from "@/components/feeds/PaperStage";
import { FeedBackdrop } from "@/components/feeds/FeedBackdrop";
import { FeedPaperDetail } from "@/components/feeds/FeedPaperDetail";
import { FeedPaperImage } from "@/components/feeds/FeedPaperImage";
import { illustrationsFor } from "@/lib/feed-illustrations";
import { StartBar, type StartMode } from "@/components/feeds/StartBar";
import { useFeedBookmarks } from "@/lib/feed-bookmarks";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { PageHeader } from "@/components/PageHeader";
import { APIError } from "@/lib/api";
import { Feed, FeedAction, FeedDomain, FeedFilter, FeedPaper, fetchFeed, sourceLabels } from "@/lib/feeds-api";
import styles from "./FeedsView.module.css";

function dateLabel(value: string | null) {
  return value ? new Date(`${value.slice(0, 10)}T12:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "Date unavailable";
}

/** The Feeds experience. `embedded` drops the page chrome (header, intro, backdrop) so it can sit
 *  inside another page, such as the home screen. */
/** Papers shown at a time. The backend returns more per request; the rest are revealed on demand. */
// Matches PAGE_SIZE in backend/app/services/feeds.py.
const PAGE = 12;

type FeedLayout = "cards" | "grid" | "list";
const FEED_LAYOUT_KEY = "sediment_feed_layout";
const FEED_LAYOUTS: { id: FeedLayout; label: string; icon: ReactNode }[] = [
  { id: "cards", label: "Cards", icon: <><rect x="2.5" y="3" width="11" height="10" rx="1.5" /><path d="M9.5 3v10" /></> },
  { id: "grid", label: "Grid", icon: <><rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" /><rect x="9" y="2.5" width="4.5" height="4.5" rx="1" /><rect x="2.5" y="9" width="4.5" height="4.5" rx="1" /><rect x="9" y="9" width="4.5" height="4.5" rx="1" /></> },
  { id: "list", label: "List", icon: <><path d="M6 4h7.5M6 8h7.5M6 12h7.5" /><circle cx="3" cy="4" r=".6" fill="currentColor" /><circle cx="3" cy="8" r=".6" fill="currentColor" /><circle cx="3" cy="12" r=".6" fill="currentColor" /></> },
];

/** The researcher's chosen feed layout, remembered in this browser. */
function useFeedLayout() {
  const [layout, setLayoutState] = useState<FeedLayout>("cards");
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(FEED_LAYOUT_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Restore the remembered layout after hydration.
      if (stored === "grid" || stored === "list" || stored === "cards") setLayoutState(stored);
    } catch {
      // Storage can be blocked; the default layout still works.
    }
  }, []);
  const setLayout = useCallback((next: FeedLayout) => {
    setLayoutState(next);
    try { window.localStorage.setItem(FEED_LAYOUT_KEY, next); } catch { /* not remembered */ }
  }, []);
  return [layout, setLayout] as const;
}

export function FeedsView({ embedded = false, ready = true, onSearch, onStartWorkspace, searching, startBarTarget }: {
  embedded?: boolean;
  /** Where the start bar renders when the page wants it somewhere other than the top of the feed. */
  startBarTarget?: HTMLElement | null;
  /** Hold the first feed request until true, so the page around the feed can load first. */
  ready?: boolean;
  /** Runs a search from the start bar (embedded only). */
  onSearch?: (query: string) => void;
  /** Starts a workspace holding these papers, with the feed interests as context. */
  onStartWorkspace?: (papers: FeedPaper[], interests: string) => void;
  searching?: boolean;
}) {
  const [layout, setLayout] = useFeedLayout();
  const [openedPaper, setOpenedPaper] = useState<FeedPaper | null>(null);
  const [feed, setFeed] = useState<Feed | null>(null);
  const [interests, setInterests] = useState("");
  const [domain, setDomain] = useState<FeedDomain>("general");
  const [editing, setEditing] = useState(false);
  const [source, setSource] = useState<FeedFilter>("all");
  const { saved, papers: savedPapers, unresolved, retryRestore, toggle } = useFeedBookmarks();
  const selection = usePaperSelection();
  const [startMode, setStartMode] = useState<StartMode | null>(null);
  const [shown, setShown] = useState(PAGE);
  const [savedOnly, setSavedOnly] = useState(false);
  const [pending, setPending] = useState<FeedAction | "restore" | null>("restore");
  const [error, setError] = useState("");
  const [needsReload, setNeedsReload] = useState(false);
  const [restoreKey, setRestoreKey] = useState(0);
  const busy = useRef(false);
  const request = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    request.current = controller;
    async function restore() {
      try {
        let result = await fetchFeed(undefined, controller.signal);
        if (!result.interests && !controller.signal.aborted) {
          // Start new visitors on a default topic. If that fails, keep the empty feed so they can type their own.
          try {
            result = await fetchFeed({ action: "interests", source: "all", domain: "ai", interests: "Artificial intelligence, machine learning, large language models" }, controller.signal);
          } catch (err) {
            if (controller.signal.aborted) throw err;
            // The save may have reached the server before failing: show what it holds now, not the empty snapshot.
            try { result = await fetchFeed(undefined, controller.signal); } catch { /* keep the empty feed */ }
          }
        }
        if (controller.signal.aborted) return;
        setSource("all");
        setShown(PAGE);
        setFeed(result);
        setInterests(result.interests);
        setDomain(result.domain);
        setEditing(!result.interests);
        setNeedsReload(false);
        setError("");
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Couldn’t restore your feed.");
      } finally {
        if (!controller.signal.aborted) setPending(null);
      }
    }
    void restore();
    return () => { controller.abort(); request.current?.abort(); };
  }, [restoreKey, ready]);

  function openPaper(paper: FeedPaper) {
    setOpenedPaper(paper);
  }

  function reload() {
    setPending("restore");
    setError("");
    setRestoreKey(key => key + 1);
  }

  async function update(action: FeedAction, selectedSource: FeedFilter = source, interestsOverride?: string): Promise<boolean> {
    if (busy.current || pending || !feed || needsReload) return false;
    busy.current = true;
    const controller = new AbortController();
    request.current = controller;
    setPending(action);
    setError("");
    let ok = false;
    try {
      const result = await fetchFeed({
        action,
        source: action === "more" || action === "source" ? selectedSource : "all",
        ...(action === "interests" ? { interests: (interestsOverride ?? interests).trim(), domain } : {}),
        ...(action === "more" && feed.cursor ? { cursor: feed.cursor } : {}),
      }, controller.signal);
      if (controller.signal.aborted) return false;
      if (action === "more") {
        if (result.revision !== feed.revision || result.source !== selectedSource) throw new APIError("Your interests changed in another tab. Reload your feed.", 409);
        // Merge repeated responses defensively without rendering duplicate cards.
        const papers = new Map(feed.papers.map(paper => [paper.id, paper]));
        result.papers.forEach(paper => papers.set(paper.id, paper));
        const next = { ...result, papers: [...papers.values()] };
        setFeed(next);
      } else if (action === "source") {
        if (result.revision !== feed.revision) throw new APIError("Your feed changed in another tab. Reload your feed.", 409);
        setFeed(result);
        setShown(PAGE);
        setSource(selectedSource);
        setSavedOnly(false);
      } else {
        setFeed(result);
        setShown(PAGE);
        setInterests(result.interests);
        setDomain(result.domain);
        setEditing(false);
        setSource("all");
        setSavedOnly(false);
      }
      ok = true;
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : "Couldn’t update your feed. Please try again.");
        if (err instanceof APIError && (err.status === 409 || err.status === 401)) setNeedsReload(true);
      }
    } finally {
      busy.current = false;
      if (!controller.signal.aborted) setPending(null);
    }
    return ok;
  }

  function toggleSaved(paper: FeedPaper) {
    try { toggle(paper); }
    catch { setError("This browser couldn’t save the bookmark. Please try again."); }
  }

  const visible = savedOnly ? savedPapers : (feed?.papers || []).slice(0, shown);
  // Assigned in feed order, so loading more never changes the drawings above.
  const illustrations = useMemo(() => illustrationsFor(visible), [visible]);
  const moreAvailable = !savedOnly && !!feed?.interests && (shown < feed.papers.length || !!feed.cursor);

  async function loadMore() {
    if (!feed) return;
    // Reveal what is already loaded first; only ask the backend once it runs out.
    if (shown + PAGE <= feed.papers.length || !feed.cursor) { setShown(count => count + PAGE); return; }
    if (await update("more")) setShown(count => count + PAGE);
  }
  const disabled = pending !== null || needsReload;
  const status = pending === "restore" ? "Restoring your feed…" : pending === "more" ? "Finding more papers…" : pending === "refresh" ? "Checking for recent papers…" : pending === "interests" ? "Finding papers for your interests…" : pending === "source" ? "Loading papers from this source…" : "";

  const withStartBarTarget = (bar: ReactNode) => startBarTarget ? createPortal(<div className={`${styles.embedded} ${styles.startSlot}`}>{bar}</div>, startBarTarget) : bar;

  return <div className={embedded ? styles.embedded : `feeds-shell ${styles.page}`}>
    {!embedded && <PageHeader title="Feeds" />}
    <main className={`${styles.main} ${!embedded && !feed?.interests && !savedOnly ? styles.mainEmpty : ""}`}>
      {!embedded && !feed?.interests && !savedOnly && <FeedBackdrop />}
      {!embedded && <section className={styles.intro}>
        <h1>Follow your curiosity.</h1>
        <p>The papers you care about, in one place.<br />Tell us what you’re exploring. Make room for something new.</p>
      </section>}
      {error && <div className={styles.error} role="alert"><p>{error}</p>{(!feed || needsReload) && <button disabled={!!pending} onClick={reload}>Reload feed</button>}</div>}
      {embedded && !editing ? withStartBarTarget(<StartBar
        mode={startMode ?? "paper"}
        onModeChange={setStartMode}
        markedCount={selection.papers.length}
        disabled={disabled || !feed}
        adding={pending === "interests"}
        searching={searching}
        onSearch={onSearch}
        onSynchronize={onStartWorkspace ? () => onStartWorkspace(selection.papers, feed?.interests ?? interests) : undefined}
        onAddInterests={async text => {
          const ok = await update("interests", "all", text);
          if (ok) setStartMode("feed");
          return ok;
        }}
      />) : feed && <section className={styles.interests} aria-label="Your research interests">
        <div className={styles.interestHeading}>{editing ? <label htmlFor="interests">What are you interested in?</label> : <strong>Your interests</strong>}</div>
        {editing ? <form onSubmit={event => { event.preventDefault(); void update("interests"); }}>
          <textarea autoFocus id="interests" value={interests} onChange={event => setInterests(event.target.value)} placeholder="Machine learning, the neuroscience of memory, climate science…" maxLength={600} rows={2} required disabled={disabled} aria-describedby="interest-help" />
          <div className={styles.formBottom}><span id="interest-help">Add up to three topics, separated by commas.</span><div className={styles.actions}>{feed.interests && <button type="button" className={styles.secondary} disabled={disabled} onClick={() => { setInterests(feed.interests); setDomain(feed.domain); setEditing(false); }}>Cancel</button>}<button className={styles.primary} disabled={!interests.trim() || disabled} type="submit">{pending === "interests" ? "Finding papers…" : feed.interests ? "Update interests" : "Create my feed"}</button></div></div>
          <div className={styles.suggestions}><span>Try</span>{["Machine learning", "Neuroscience", "Climate science"].map(topic => <button key={topic} type="button" disabled={disabled} onClick={() => setInterests(current => (current ? `${current.replace(/[., ]+$/, "")}, ${topic.toLowerCase()}` : topic).slice(0, 600))}>{topic} <span aria-hidden="true">+</span></button>)}</div>
        </form> : <div className={styles.applied}><p>{feed.interests}</p><button disabled={disabled} onClick={() => setEditing(true)}>Edit interests</button></div>}
      </section>}
      <div className={styles.status} role="status" aria-live="polite" aria-atomic="true">
        {status && <>
          <span className={styles.searchAnimation} aria-hidden="true"><span /><span /><span /></span>
          <span>{status}{pending !== "restore" && <span className={styles.statusHint}>This can take a moment.</span>}</span>
        </>}
      </div>
      <section className={styles.feed} aria-label={savedOnly ? "Saved papers" : "Paper library"} aria-busy={!savedOnly && !!pending}>
        <div className={styles.feedHeading}>
          <div>
            <h2 id="feed-heading" className={styles.feedTabs}>
              <button type="button" aria-pressed={!savedOnly} onClick={() => setSavedOnly(false)}>Latest research</button>
              <span aria-hidden="true">/</span>
              <button type="button" aria-pressed={savedOnly} onClick={() => setSavedOnly(true)}>Saved</button>
            </h2>
            {(savedOnly || feed?.refreshedAt) && <p>{savedOnly ? "Your saved papers, across all topics and fields." : `Last checked ${new Date(feed!.refreshedAt!).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}.`}</p>}
          </div>
          <div className={styles.headingTools}>
          {!!visible.length && <div className={styles.layouts} role="group" aria-label="Layout">
            {FEED_LAYOUTS.map(option => <button key={option.id} type="button" aria-pressed={layout === option.id} aria-label={option.label} title={option.label} onClick={() => setLayout(option.id)}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{option.icon}</svg>
            </button>)}
          </div>}
          {feed?.interests && !savedOnly && <div className={styles.actions}><button type="button" className={styles.iconButton} aria-label="Edit interests" title="Edit interests" aria-expanded={editing} disabled={disabled} onClick={() => setEditing(current => !current)}><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m10 3 3 3M3 10l7.5-7.5a2.1 2.1 0 0 1 3 3L6 13l-4 1 1-4Z" /></svg></button><button type="button" className={styles.iconButton} aria-label="Refresh feed" title="Refresh feed" data-busy={pending === "refresh" || undefined} disabled={disabled || editing} onClick={() => void update("refresh")}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" /><path d="M13.5 2.5v3h-3" /></svg>
          </button></div>}
          </div>
        </div>
        {!savedOnly && !!feed?.interests && !!feed.warnings.length && <p className={styles.warning} role="status">{feed.warnings.map(value => sourceLabels[value]).join(", ")} couldn’t be reached. Showing available papers; try refreshing later.</p>}
        {(feed?.interests || savedOnly) && <>
        {!savedOnly && (["arxiv", "biorxiv", "medrxiv"] as FeedFilter[]).includes(source) && <p className={styles.warning}>{sourceLabels[source as keyof typeof sourceLabels]} papers via OpenAlex. New submissions may take time to appear.</p>}
        {!savedOnly && source === "huggingface" && <p className={styles.warning}>Hugging Face via OpenAlex. This source primarily indexes datasets, so matching research papers may be unavailable.</p>}
        {savedOnly && unresolved.length > 0 && <p className={styles.warning} role="status">Restoring {unresolved.length} previously saved {unresolved.length === 1 ? "paper" : "papers"}. If they don’t appear, <button onClick={retryRestore}>retry restoration</button>.</p>}
        <div className={styles.list} data-layout={layout}>
          {visible.map(paper => <article className={`${styles.card} ${selection.has(paper.id) ? styles.cardMarked : ""}`} key={paper.id}>
            <FeedPaperImage paper={paper} className={styles.figure} illustration={illustrations.get(paper.id)} />
            <div className={styles.cardBody}>
              <div className={styles.cardMeta}><span>{paper.topics[0] || (paper.preprint ? "Preprint" : "Research paper")}</span><time dateTime={paper.published || undefined}>{dateLabel(paper.published)}</time></div>
              <h3><button type="button" className={styles.paperLink} onClick={() => openPaper(paper)}>{paper.title}</button></h3>
              {!!paper.authors.length && <p className={styles.authors}>{paper.authors.slice(0, 3).join(", ")}{paper.authors.length > 3 ? " & collaborators" : ""}</p>}
              {paper.abstract && <p data-preview className={styles.summary}>{paper.abstract}</p>}
              <div className={styles.cardFooter}><div className={styles.cardActions}><PaperSelectionControl title={paper.title} selected={selection.has(paper.id)} onToggle={() => selection.toggle(paper)} /><button aria-label={`${saved.includes(paper.id) ? "Unsave" : "Save"} ${paper.title}`} aria-pressed={saved.includes(paper.id)} onClick={() => toggleSaved(paper)}><svg width="15" height="17" viewBox="0 0 16 18" fill={saved.includes(paper.id) ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.3" aria-hidden="true"><path d="M3 2h10v14l-5-3-5 3z" /></svg>{saved.includes(paper.id) ? "Saved" : "Save"}</button></div></div>
            </div>
          </article>)}
        </div>
        {!visible.length && <div className={styles.empty}><h3>{savedOnly ? "Keep something for later." : "No matching papers yet."}</h3><p>{savedOnly ? "Papers you save stay here across topics and fields in this browser." : source !== "all" ? "Try another source or load more papers." : "Try broader interests, or check for more results below."}</p>{feed?.interests && (source !== "all" || savedOnly) && <button disabled={disabled || editing} onClick={() => { setSavedOnly(false); void update("source", "all"); }}>Show all papers</button>}</div>}
        {moreAvailable && <div className={styles.loadMore}><button className={styles.secondary} disabled={disabled || editing} onClick={() => void loadMore()}>{pending === "more" ? "Loading…" : "Load more papers"}</button></div>}
        <p className={styles.endnote}>{savedOnly ? "Saved in this browser, across all your topics and fields." : moreAvailable ? (source === "all" ? "" : "Up to 12 new papers at a time.") : "You’re caught up with the available results. Refresh later or edit your interests."}{(savedOnly || !moreAvailable || source !== "all") && <br />}Topic illustrations are decorative. Open a paper for its full abstract and original source.</p>
        </>}
      </section>
    </main>
    <PaperStage
      papers={selection.papers}
      onRemove={selection.toggle}
      onClear={selection.clear}
      onOpen={openPaper}
      feedPapers={feed?.papers.slice(0, shown) ?? []}
      interests={feed?.interests ?? interests}
      domain={feed?.domain ?? domain}
      onMark={found => selection.add(found.map(paper => feed?.papers.find(item => item.id === paper.id) ?? paper))}
      onInterests={text => { setInterests(text); void update("interests", "all", text); }}
      onStartWorkspace={onStartWorkspace ? chosen => onStartWorkspace(chosen, feed?.interests ?? interests) : undefined}
    />
    {openedPaper && <FeedPaperDetail paper={openedPaper} intercepted onClose={() => setOpenedPaper(null)} />}
  </div>;
}
