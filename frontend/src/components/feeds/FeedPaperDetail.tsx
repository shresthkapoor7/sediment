"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FeedPaper, sourceLabels } from "@/lib/feeds-api";
import { useFeedBookmarks } from "@/lib/feed-bookmarks";
import { FeedPaperImage } from "./FeedPaperImage";
import styles from "./FeedPaperDetail.module.css";

function date(value: string) {
  return new Date(`${value.slice(0, 10)}T12:00:00Z`).toLocaleDateString(undefined, { dateStyle: "long", timeZone: "UTC" });
}

export function FeedPaperDetail({ paper, intercepted = false, missing = false, loading = false }: {
  paper: FeedPaper | null; intercepted?: boolean; missing?: boolean; loading?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const { saved, toggle } = useFeedBookmarks();
  const [error, setError] = useState("");
  const close = () => intercepted ? router.back() : router.replace("/feeds");
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    element?.showModal();
    return () => { element?.close(); previous?.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => {
    if (!paper) return;
    const previous = document.title;
    document.title = `${paper.title} | Sediment`;
    return () => { document.title = previous; };
  }, [paper]);
  const external = paper && /^https?:\/\//.test(paper.url) ? paper.url : null;
  return <dialog ref={dialog} className={styles.dialog} aria-labelledby="paper-detail-title" onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <div className={styles.surface}>
      <header className={styles.header}><span>Sediment <span>/</span> Paper</span><button type="button" aria-label="Close paper details" onClick={close} autoFocus><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></button></header>
      {paper ? <article className={styles.content}>
        <div className={styles.meta}>{paper.preprint ? "Preprint" : "Research paper"}{paper.published && <><span>·</span><time dateTime={paper.published}>{date(paper.published)}</time></>}</div>
        <h1 id="paper-detail-title">{paper.title}</h1>
        {!!paper.authors.length && <p className={styles.authors}>{paper.authors.join(", ")}</p>}
        <div className={styles.actions}>{external && <a className={styles.primary} href={external} target="_blank" rel="noopener noreferrer">Read original paper</a>}<button aria-pressed={saved.includes(paper.id)} onClick={() => { try { toggle(paper.id); setError(""); } catch { setError("This browser couldn’t save the bookmark. Please try again."); } }}><svg width="15" height="17" viewBox="0 0 16 18" fill={saved.includes(paper.id) ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.3" aria-hidden="true"><path d="M3 2h10v14l-5-3-5 3z" /></svg>{saved.includes(paper.id) ? "Saved" : "Save paper"}</button></div>
        {error && <p role="alert" className={styles.error}>{error}</p>}
        <FeedPaperImage paper={paper} className={styles.figure} />
        <section className={styles.abstract} aria-labelledby="abstract-heading"><h2 id="abstract-heading">Abstract</h2><p>{paper.abstract || "An abstract wasn’t provided for this paper. You can read more at the original source."}</p></section>
        {!!paper.topics.length && <ul className={styles.topics} aria-label="Topics">{paper.topics.map(topic => <li key={topic}>{topic}</li>)}</ul>}
        <dl className={styles.facts}><div><dt>Sources</dt><dd>{paper.sources.map(source => sourceLabels[source]).join(" · ")}</dd></div>{paper.updated && <div><dt>Updated</dt><dd>{date(paper.updated)}</dd></div>}{paper.doi && <div><dt>DOI</dt><dd><a href={`https://doi.org/${paper.doi}`} target="_blank" rel="noopener noreferrer">{paper.doi}</a></dd></div>}{paper.arxiv_id && <div><dt>arXiv</dt><dd><a href={`https://arxiv.org/abs/${paper.arxiv_id}`} target="_blank" rel="noopener noreferrer">{paper.arxiv_id}</a></dd></div>}{paper.openalex_id && <div><dt>OpenAlex</dt><dd><a href={`https://openalex.org/${paper.openalex_id}`} target="_blank" rel="noopener noreferrer">{paper.openalex_id}</a></dd></div>}</dl>
      </article> : <div className={styles.empty}><h1 id="paper-detail-title">{loading ? "Loading paper…" : missing ? "Paper not found" : "Couldn’t load this paper"}</h1><p role="status">{loading ? "Opening the saved paper details." : missing ? "This paper is no longer available in the feed library." : "Please try again in a moment."}</p>{!loading && !missing && <button onClick={() => router.refresh()}>Try again</button>}<button onClick={close}>Back to feed</button></div>}
    </div>
  </dialog>;
}
