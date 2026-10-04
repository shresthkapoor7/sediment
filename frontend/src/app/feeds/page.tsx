"use client";

import Link from "next/link";
import { usePaperSelection } from "@/lib/paper-selection";
import { PaperSelectionControl } from "@/components/feeds/PaperSelectionControl";
import { FeedBackdrop } from "@/components/feeds/FeedBackdrop";
import { FeedPaperDetail } from "@/components/feeds/FeedPaperDetail";
import { FeedPaperImage } from "@/components/feeds/FeedPaperImage";
import { useFeedBookmarks } from "@/lib/feed-bookmarks";
import { useEffect, useRef, useState } from "react";
import { BalancedMasonry } from "@/components/feeds/BalancedMasonry";
import { PageHeader } from "@/components/PageHeader";
import { APIError } from "@/lib/api";
import { Feed, FeedAction, FeedDomain, domainLabels, FeedFilter, FeedPaper, fetchFeed, sourceLabels, feedPaperPath } from "@/lib/feeds-api";
import styles from "./page.module.css";

function dateLabel(value: string | null) {
  return value ? new Date(`${value.slice(0, 10)}T12:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "Date unavailable";
}

export default function FeedsPage() {
  const [openedPaper, setOpenedPaper] = useState<FeedPaper | null>(null);
  const [feed, setFeed] = useState<Feed | null>(null);
  const [interests, setInterests] = useState("");
  const [domain, setDomain] = useState<FeedDomain>("general");
  const [editing, setEditing] = useState(false);
  const [source, setSource] = useState<FeedFilter>("all");
  const { saved, papers: savedPapers, unresolved, retryRestore, toggle } = useFeedBookmarks();
  const [savedOnly, setSavedOnly] = useState(false);
  const selection = usePaperSelection();
  const [selectedOnly, setSelectedOnly] = useState(false);
  const libraryView = savedOnly || selectedOnly;
  const [pending, setPending] = useState<FeedAction | "restore" | null>("restore");
  const [error, setError] = useState("");
  const [needsReload, setNeedsReload] = useState(false);
  const [restoreKey, setRestoreKey] = useState(0);
  const busy = useRef(false);
  const request = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    request.current = controller;
    async function restore() {
      try {
        const result = await fetchFeed(undefined, controller.signal);
        if (controller.signal.aborted) return;
        setSource("all");
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
  }, [restoreKey]);

  useEffect(() => {
    function restoreOverlay() {
      const paper = window.history.state?.sedimentFeedPaper as FeedPaper | undefined;
      setOpenedPaper(paper && feedPaperPath(paper) === window.location.pathname ? paper : null);
    }
    window.addEventListener("popstate", restoreOverlay);
    return () => window.removeEventListener("popstate", restoreOverlay);
  }, []);

  function openPaper(paper: FeedPaper) {
    // Native history keeps this feed, its loaded pages, and scroll position
    // mounted. The same URL has a server-rendered route for direct visits.
    window.history.pushState({ sedimentFeedPaper: paper }, "", feedPaperPath(paper));
    setOpenedPaper(paper);
  }

  function reload() {
    setPending("restore");
    setError("");
    setRestoreKey(key => key + 1);
  }

  async function update(action: FeedAction, selectedSource: FeedFilter = source) {
    if (busy.current || pending || !feed || needsReload) return;
    busy.current = true;
    const controller = new AbortController();
    request.current = controller;
    setPending(action);
    setError("");
    try {
      const result = await fetchFeed({
        action,
        source: action === "more" || action === "source" ? selectedSource : "all",
        ...(action === "interests" ? { interests: interests.trim(), domain } : {}),
        ...(action === "more" && feed.cursor ? { cursor: feed.cursor } : {}),
      }, controller.signal);
      if (controller.signal.aborted) return;
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
        setSource(selectedSource);
        setSavedOnly(false);
        setSelectedOnly(false);
      } else {
        setFeed(result);
        setInterests(result.interests);
        setDomain(result.domain);
        setEditing(false);
        setSource("all");
        setSavedOnly(false);
        setSelectedOnly(false);
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : "Couldn’t update your feed. Please try again.");
        if (err instanceof APIError && (err.status === 409 || err.status === 401)) setNeedsReload(true);
      }
    } finally {
      busy.current = false;
      if (!controller.signal.aborted) setPending(null);
    }
  }

  function toggleSaved(paper: FeedPaper) {
    try { toggle(paper); }
    catch { setError("This browser couldn’t save the bookmark. Please try again."); }
  }

  const visible = selectedOnly ? selection.papers : savedOnly ? savedPapers : (feed?.papers || []);
  const disabled = pending !== null || needsReload;
  const status = pending === "restore" ? "Restoring your feed…" : pending === "more" ? "Finding more papers…" : pending === "refresh" ? "Checking for recent papers…" : pending === "interests" ? "Finding papers for your interests…" : pending === "source" ? "Loading papers from this source…" : "";

  return <div className={`feeds-shell ${styles.page}`}>
    <PageHeader title="Feeds" />
    <main className={`${styles.main} ${!feed?.interests && !libraryView ? styles.mainEmpty : ""}`}>
      {!feed?.interests && !libraryView && <FeedBackdrop />}
      <section className={styles.intro}>
        <h1>Follow your curiosity.</h1>
        <p>The papers you care about, in one place.<br />Tell us what you’re exploring. Make room for something new.</p>
      </section>
      {error && <div className={styles.error} role="alert"><p>{error}</p>{(!feed || needsReload) && <button disabled={!!pending} onClick={reload}>Reload feed</button>}</div>}
      {feed && <section className={styles.interests} aria-label="Your research interests">
        <div className={styles.interestHeading}>{editing ? <label htmlFor="interests">What are you interested in?</label> : <strong>Your interests</strong>}<span>Saved for this browser</span></div>
        {editing ? <form onSubmit={event => { event.preventDefault(); void update("interests"); }}>
          <div className={styles.domainField}>
            <label htmlFor="research-domain">Your field</label>
            <select id="research-domain" value={domain} onChange={event => setDomain(event.target.value as FeedDomain)} disabled={disabled} aria-describedby="domain-help">
              {(Object.keys(domainLabels) as FeedDomain[]).map(value => <option key={value} value={value}>{domainLabels[value]}</option>)}
            </select>
            <span id="domain-help">Tailors the papers and sources in your feed.</span>
          </div>
          <textarea id="interests" value={interests} onChange={event => setInterests(event.target.value)} placeholder="Machine learning, the neuroscience of memory, climate science…" maxLength={600} rows={2} required disabled={disabled} aria-describedby="interest-help" />
          <div className={styles.formBottom}><span id="interest-help">Add up to three topics, separated by commas.</span><div className={styles.actions}>{feed.interests && <button type="button" className={styles.secondary} disabled={disabled} onClick={() => { setInterests(feed.interests); setDomain(feed.domain); setEditing(false); }}>Cancel</button>}<button className={styles.primary} disabled={!interests.trim() || disabled} type="submit">{pending === "interests" ? "Finding papers…" : feed.interests ? "Update interests" : "Create my feed"}</button></div></div>
          <div className={styles.suggestions}><span>Try</span>{["Machine learning", "Neuroscience", "Climate science"].map(topic => <button key={topic} type="button" disabled={disabled} onClick={() => setInterests(current => (current ? `${current.replace(/[., ]+$/, "")}, ${topic.toLowerCase()}` : topic).slice(0, 600))}>{topic} <span aria-hidden="true">+</span></button>)}</div>
        </form> : <div className={styles.applied}><p><span className={styles.domainLabel}>{domainLabels[feed.domain]}</span>{feed.interests}</p><button disabled={disabled} onClick={() => setEditing(true)}>Edit interests</button></div>}
      </section>}
      <div className={styles.status} role="status" aria-live="polite" aria-atomic="true">
        {status && <>
          <span className={styles.searchAnimation} aria-hidden="true"><span /><span /><span /></span>
          <span>{status}{pending !== "restore" && <span className={styles.statusHint}>This can take a moment.</span>}</span>
        </>}
      </div>
      <section className={styles.feed} aria-label={selectedOnly ? "Selected papers" : savedOnly ? "Saved papers" : "Paper library"} aria-busy={!libraryView && !!pending}>
        {(feed?.interests || libraryView) && <div className={styles.feedHeading}><div><h2 id="feed-heading">{selectedOnly ? "Selected papers" : savedOnly ? "Saved papers" : "Your feed"}</h2><p>{selectedOnly ? "Your selection across sources and topics. Reloading clears it." : savedOnly ? "Your saved papers, across all topics and fields." : feed?.refreshedAt ? `Last checked ${new Date(feed.refreshedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}. ` : ""}{!libraryView && "Refresh when you’re ready for more."}</p></div>{feed?.interests && <button className={styles.secondary} disabled={disabled || editing} onClick={() => void update("refresh")}>{pending === "refresh" ? "Refreshing…" : "Refresh feed"}</button>}</div>}
        {!libraryView && !!feed?.interests && !!feed.warnings.length && <p className={styles.warning} role="status">{feed.warnings.map(value => sourceLabels[value]).join(", ")} couldn’t be reached. Showing available papers; try refreshing later.</p>}
        <div className={`${styles.toolbar} ${!feed?.interests ? styles.savedToolbar : ""}`}>{feed?.interests && <div className={styles.filters} aria-label="Filter by source">{(["all", ...feed.availableSources] as FeedFilter[]).map(value => <button key={value} aria-pressed={!libraryView && source === value} disabled={disabled || editing} onClick={() => void update("source", value)} className={!libraryView && source === value ? styles.active : ""}>{value === "all" ? "All papers" : sourceLabels[value]}</button>)}</div>}<button className={`${styles.savedFilter} ${savedOnly ? styles.active : ""}`} aria-pressed={savedOnly} onClick={() => { setSavedOnly(value => !value); setSelectedOnly(false); }}>Saved <span>{saved.length}</span></button></div>
        {(visible.length > 0 || selection.papers.length > 0 || selectedOnly) && <div className={styles.selectionBar} aria-label="Paper selection">
          <span role="status">{selection.papers.length} selected</span>
          <div>
            <button aria-pressed={selectedOnly} disabled={!selection.papers.length && !selectedOnly} onClick={() => { setSelectedOnly(value => !value); setSavedOnly(false); }}>{selectedOnly ? "Back to feed" : "Show selected"}</button>
            <button disabled={!selection.papers.length} onClick={() => { selection.clear(); setSelectedOnly(false); }}>Clear selection</button>
          </div>
        </div>}
        {(feed?.interests || libraryView) && <>
        {!libraryView && (["arxiv", "biorxiv", "medrxiv"] as FeedFilter[]).includes(source) && <p className={styles.warning}>{sourceLabels[source as keyof typeof sourceLabels]} papers via OpenAlex. New submissions may take time to appear.</p>}
        {!libraryView && source === "huggingface" && <p className={styles.warning}>Hugging Face via OpenAlex. This source primarily indexes datasets, so matching research papers may be unavailable.</p>}
        <div className={styles.resultCount} role="status">{selectedOnly ? `${visible.length} selected papers` : savedOnly ? `${visible.length} saved papers` : `${visible.length} of ${feed?.papers.length || 0} loaded papers`} <span>{libraryView ? "Across all topics and fields" : "Recent research"}</span></div>
        {savedOnly && unresolved.length > 0 && <p className={styles.warning} role="status">Restoring {unresolved.length} previously saved {unresolved.length === 1 ? "paper" : "papers"}. If they don’t appear, <button onClick={retryRestore}>retry restoration</button>.</p>}
        <BalancedMasonry className={styles.masonry}>
          {visible.map(paper => <article className={`${styles.card} ${selection.has(paper.id) ? styles.cardSelected : ""}`} key={paper.id} data-selected={selection.has(paper.id) || undefined}>
            <FeedPaperImage paper={paper} className={styles.figure} />
            <div className={styles.cardBody}>
              <div className={styles.cardSelection}><PaperSelectionControl title={paper.title} selected={selection.has(paper.id)} onToggle={() => selection.toggle(paper)} /></div>
              <div className={styles.cardMeta}><span>{paper.topics[0] || (paper.preprint ? "Preprint" : "Research paper")}</span><time dateTime={paper.published || undefined}>{dateLabel(paper.published)}</time></div>
              <h3><Link className={styles.paperLink} href={feedPaperPath(paper)} scroll={false} prefetch={false} onClick={event => { if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); openPaper(paper); } }}>{paper.title}</Link></h3>
              {!!paper.authors.length && <p className={styles.authors}>{paper.authors.slice(0, 3).join(", ")}{paper.authors.length > 3 ? " & collaborators" : ""}</p>}
              {paper.abstract && <p data-preview className={styles.summary}>{paper.abstract}</p>}
              <div className={styles.cardFooter}><span>{paper.sources.map(value => sourceLabels[value]).join(" · ")}{paper.preprint && <small>Preprint</small>}</span><button aria-label={`${saved.includes(paper.id) ? "Unsave" : "Save"} ${paper.title}`} aria-pressed={saved.includes(paper.id)} onClick={() => toggleSaved(paper)}><svg width="15" height="17" viewBox="0 0 16 18" fill={saved.includes(paper.id) ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.3" aria-hidden="true"><path d="M3 2h10v14l-5-3-5 3z" /></svg>{saved.includes(paper.id) ? "Saved" : "Save"}</button></div>
            </div>
          </article>)}
        </BalancedMasonry>
        {!visible.length && <div className={styles.empty}><h3>{selectedOnly ? "No papers selected." : savedOnly ? "Keep something for later." : "No matching papers yet."}</h3><p>{selectedOnly ? "Select papers from your feed or saved papers to collect them here." : savedOnly ? "Papers you save stay here across topics and fields in this browser." : source !== "all" ? "Try another source or load more papers." : "Try broader interests, or check for more results below."}</p>{feed?.interests && (source !== "all" || libraryView) && <button disabled={disabled || editing} onClick={() => { setSavedOnly(false); setSelectedOnly(false); void update("source", "all"); }}>Show all papers</button>}</div>}
        {!libraryView && feed?.interests && feed.cursor && <div className={styles.loadMore}><button className={styles.secondary} disabled={disabled || editing} onClick={() => void update("more")}>{pending === "more" ? "Loading…" : "Load more papers"}</button></div>}
        <p className={styles.endnote}>{selectedOnly ? "Selection stays available while this feed page is open. Save papers to keep them for later." : savedOnly ? "Saved in this browser, across all your topics and fields." : feed?.cursor ? (source === "all" ? "Up to 10 papers per source at a time, with duplicates combined." : "Up to 10 new papers at a time.") : "You’re caught up with the available results. Refresh later or edit your interests."}<br />Topic illustrations are decorative. Open a paper for its full abstract and original source.</p>
        </>}
      </section>
    </main>
    {openedPaper && <FeedPaperDetail paper={openedPaper} intercepted />}
  </div>;
}
