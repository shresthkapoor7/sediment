"use client";

import { useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { APIError, getOrCreateAnonymousUserId } from "@/lib/api";
import { Feed, FeedAction, FeedPaper, FeedFilter, fetchFeed, sourceLabels } from "@/lib/feeds-api";
import { illustrationFor } from "@/lib/feed-illustrations";
import styles from "./page.module.css";

function PaperImage({ paper }: { paper: FeedPaper }) {
  const [failed, setFailed] = useState<string[]>([]);
  const illustration = illustrationFor(paper);
  const thumbnail = paper.thumbnail?.startsWith("https://cdn-thumbnails.huggingface.co/") ? paper.thumbnail : null;
  const src = [thumbnail, illustration].find(candidate => candidate && !failed.includes(candidate));
  if (!src) return null;
  return <figure className={styles.figure}>
    {/* Provider thumbnails and local SVGs are served directly without an image transformation service. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(current => [...current, src])} />
    <figcaption>{src === thumbnail ? "Paper thumbnail · Hugging Face" : "Topic illustration"}</figcaption>
  </figure>;
}

function dateLabel(value: string | null) {
  return value ? new Date(`${value.slice(0, 10)}T12:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "Date unavailable";
}

export default function FeedsPage() {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [interests, setInterests] = useState("");
  const [editing, setEditing] = useState(false);
  const [source, setSource] = useState<FeedFilter>("all");
  const [saved, setSaved] = useState<string[]>([]);
  const [savedOnly, setSavedOnly] = useState(false);
  const [pending, setPending] = useState<FeedAction | "restore" | null>("restore");
  const [error, setError] = useState("");
  const [needsReload, setNeedsReload] = useState(false);
  const [restoreKey, setRestoreKey] = useState(0);
  const views = useRef<Partial<Record<FeedFilter, Feed>>>({});
  const user = useRef("");
  const busy = useRef(false);
  const request = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    request.current = controller;
    async function restore() {
      try {
        user.current = getOrCreateAnonymousUserId();
        const result = await fetchFeed(user.current, undefined, controller.signal);
        if (controller.signal.aborted) return;
        views.current = { all: result };
        setSource("all");
        setFeed(result);
        setInterests(result.interests);
        setEditing(!result.interests);
        setNeedsReload(false);
        setError("");
        try {
          const ids = JSON.parse(localStorage.getItem("sediment_feed_saved") || "[]");
          if (Array.isArray(ids)) setSaved(ids.filter(id => typeof id === "string"));
        } catch { /* Bookmarks are optional; feed persistence lives on the server. */ }
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Couldn’t restore your feed.");
      } finally {
        if (!controller.signal.aborted) setPending(null);
      }
    }
    void restore();
    return () => { controller.abort(); request.current?.abort(); };
  }, [restoreKey]);

  function reload() {
    setPending("restore");
    setError("");
    setRestoreKey(key => key + 1);
  }

  async function update(action: FeedAction, selectedSource: FeedFilter = source) {
    if (busy.current || pending || !feed || needsReload) return;
    if (action === "source" && views.current[selectedSource]) {
      setFeed(views.current[selectedSource]!);
      setSource(selectedSource);
      setSavedOnly(false);
      setError("");
      return;
    }
    busy.current = true;
    const controller = new AbortController();
    request.current = controller;
    setPending(action);
    setError("");
    try {
      const result = await fetchFeed(user.current, {
        action,
        source: action === "more" || action === "source" ? selectedSource : "all",
        ...(action === "interests" ? { interests: interests.trim() } : {}),
        ...(action === "more" && feed.cursor ? { cursor: feed.cursor } : {}),
      }, controller.signal);
      if (controller.signal.aborted) return;
      if (action === "more") {
        if (result.revision !== feed.revision || result.source !== selectedSource) throw new APIError("Your interests changed in another tab. Reload your feed.", 409);
        // Merge repeated responses defensively without rendering duplicate cards.
        const papers = new Map(feed.papers.map(paper => [paper.id, paper]));
        result.papers.forEach(paper => papers.set(paper.id, paper));
        const next = { ...result, papers: [...papers.values()] };
        views.current[selectedSource] = next;
        setFeed(next);
      } else if (action === "source") {
        if (result.revision !== feed.revision) throw new APIError("Your feed changed in another tab. Reload your feed.", 409);
        views.current[selectedSource] = result;
        setFeed(result);
        setSource(selectedSource);
        setSavedOnly(false);
      } else {
        views.current = { all: result };
        setFeed(result);
        setInterests(result.interests);
        setEditing(false);
        setSource("all");
        setSavedOnly(false);
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : "Couldn’t update your feed. Please try again.");
        if (err instanceof APIError && err.status === 409) setNeedsReload(true);
      }
    } finally {
      busy.current = false;
      if (!controller.signal.aborted) setPending(null);
    }
  }

  function toggleSaved(id: string) {
    const next = saved.includes(id) ? saved.filter(value => value !== id) : [...saved, id];
    setSaved(next);
    try { localStorage.setItem("sediment_feed_saved", JSON.stringify(next)); }
    catch { setError("This browser couldn’t save bookmarks. Your selection will last for this visit."); }
  }

  const visible = (feed?.papers || []).filter(paper => !savedOnly || saved.includes(paper.id));
  const disabled = pending !== null || needsReload;
  const status = pending === "restore" ? "Restoring your feed…" : pending === "more" ? "Finding more papers…" : pending === "refresh" ? "Checking for recent papers…" : pending === "interests" ? "Finding papers for your interests…" : pending === "source" ? "Loading papers from this source…" : "";

  return <div className={styles.page}>
    <PageHeader title="Feeds" />
    <main className={styles.main}>
      <section className={styles.intro}>
        <div className={styles.eyebrow}><span /> A little closer to your next idea</div>
        <h1>Follow your curiosity.</h1>
        <p>The papers you care about, in one place.<br />Tell us what you’re exploring. Make room for something new.</p>
      </section>
      {error && <div className={styles.error} role="alert"><p>{error}</p>{(!feed || needsReload) && <button disabled={!!pending} onClick={reload}>Reload feed</button>}</div>}
      {feed && <section className={styles.interests} aria-label="Your research interests">
        <div className={styles.interestHeading}>{editing ? <label htmlFor="interests">What are you interested in?</label> : <strong>Your interests</strong>}<span>Saved for this browser</span></div>
        {editing ? <form onSubmit={event => { event.preventDefault(); void update("interests"); }}>
          <textarea id="interests" value={interests} onChange={event => setInterests(event.target.value)} placeholder="Machine learning, the neuroscience of memory, climate science…" maxLength={600} rows={2} required disabled={disabled} aria-describedby="interest-help" />
          <div className={styles.formBottom}><span id="interest-help">Add up to three topics, separated by commas.</span><div className={styles.actions}>{feed.interests && <button type="button" className={styles.secondary} disabled={disabled} onClick={() => { setInterests(feed.interests); setEditing(false); }}>Cancel</button>}<button className={styles.primary} disabled={!interests.trim() || disabled} type="submit">{pending === "interests" ? "Finding papers…" : feed.interests ? "Update interests" : "Create my feed"}</button></div></div>
          <div className={styles.suggestions}><span>Try</span>{["Machine learning", "Neuroscience", "Climate science"].map(topic => <button key={topic} type="button" disabled={disabled} onClick={() => setInterests(current => (current ? `${current.replace(/[., ]+$/, "")}, ${topic.toLowerCase()}` : topic).slice(0, 600))}>{topic} <span aria-hidden="true">+</span></button>)}</div>
        </form> : <div className={styles.applied}><p>{feed.interests}</p><button disabled={disabled} onClick={() => setEditing(true)}>Edit interests</button></div>}
      </section>}
      <p className={styles.status} role="status">{status}{pending && pending !== "restore" && " This can take a moment."}</p>
      {feed && !feed.interests && <section className={styles.welcome}><h2>Your next discovery starts here.</h2><p>Add your interests above to build a feed of recent research.</p></section>}
      {feed?.interests && <section className={styles.feed} aria-labelledby="feed-heading" aria-busy={!!pending}>
        <div className={styles.feedHeading}><div><h2 id="feed-heading">{savedOnly ? "Saved in this feed" : "Your feed"}</h2><p>{feed.refreshedAt ? `Last checked ${new Date(feed.refreshedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}. ` : ""}Refresh when you’re ready for more.</p></div><button className={styles.secondary} disabled={disabled || editing} onClick={() => void update("refresh")}>{pending === "refresh" ? "Refreshing…" : "Refresh feed"}</button></div>
        {!!feed.warnings.length && <p className={styles.warning} role="status">{feed.warnings.map(value => sourceLabels[value]).join(", ")} couldn’t be reached. Showing available papers; try refreshing later.</p>}
        <div className={styles.toolbar}><div className={styles.filters} aria-label="Filter by source">{(["all", "arxiv", "huggingface", "openalex"] as const).map(value => <button key={value} aria-pressed={source === value} disabled={disabled || editing} onClick={() => void update("source", value)} className={source === value ? styles.active : ""}>{value === "all" ? "All papers" : sourceLabels[value]}</button>)}</div><button className={`${styles.savedFilter} ${savedOnly ? styles.active : ""}`} aria-pressed={savedOnly} onClick={() => setSavedOnly(value => !value)}>Saved <span>{feed.papers.filter(paper => saved.includes(paper.id)).length}</span></button></div>
        <div className={styles.resultCount} role="status">{visible.length} of {feed.papers.length} loaded papers <span>Recent research</span></div>
        <div className={styles.masonry}>
          {visible.map(paper => <article className={styles.card} key={paper.id}>
            <PaperImage paper={paper} />
            <div className={styles.cardBody}>
              <div className={styles.cardMeta}><span>{paper.topics[0] || (paper.preprint ? "Preprint" : "Research paper")}</span><time dateTime={paper.published || undefined}>{dateLabel(paper.published)}</time></div>
              <h3><a href={paper.url} target="_blank" rel="noopener noreferrer">{paper.title}</a></h3>
              {!!paper.authors.length && <p className={styles.authors}>{paper.authors.slice(0, 3).join(", ")}{paper.authors.length > 3 ? " & collaborators" : ""}</p>}
              {paper.abstract && <p className={styles.summary}>{paper.abstract.length > 360 ? `${paper.abstract.slice(0, 360).replace(/\s+\S*$/, "")}…` : paper.abstract}</p>}
              <div className={styles.cardFooter}><span>{paper.sources.map(value => sourceLabels[value]).join(" · ")}{paper.preprint && <small>Preprint</small>}</span><button aria-label={`${saved.includes(paper.id) ? "Unsave" : "Save"} ${paper.title}`} aria-pressed={saved.includes(paper.id)} onClick={() => toggleSaved(paper.id)}><svg width="15" height="17" viewBox="0 0 16 18" fill={saved.includes(paper.id) ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.3" aria-hidden="true"><path d="M3 2h10v14l-5-3-5 3z" /></svg>{saved.includes(paper.id) ? "Saved" : "Save"}</button></div>
            </div>
          </article>)}
        </div>
        {!visible.length && <div className={styles.empty}><h3>{savedOnly ? "Keep something for later." : "No matching papers yet."}</h3><p>{savedOnly ? "Papers you save from this feed will appear here." : source !== "all" ? "Try another source or load more papers." : "Try broader interests, or check for more results below."}</p>{(source !== "all" || savedOnly) && <button disabled={disabled || editing} onClick={() => { setSavedOnly(false); void update("source", "all"); }}>Show all papers</button>}</div>}
        {feed.cursor && <div className={styles.loadMore}><button className={styles.secondary} disabled={disabled || editing} onClick={() => void update("more")}>{pending === "more" ? "Loading…" : "Load more papers"}</button></div>}
        <p className={styles.endnote}>{feed.cursor ? "Up to 12 new papers at a time." : "You’re caught up with the available results. Refresh later or edit your interests."}<br />Topic illustrations are decorative. Paper links open the original source.</p>
      </section>}
    </main>
  </div>;
}
