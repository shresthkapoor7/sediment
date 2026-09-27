"use client";

import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import styles from "./page.module.css";

const topics = ["All papers", "Machine learning", "Neuroscience", "Climate science"];
const papers = [
  { id: 1, topic: "Machine learning", title: "Teaching models to reason beyond their training data", authors: "A. Chen, M. Patel & collaborators", summary: "What happens when a model encounters a problem it has never seen? A closer look at compositional reasoning, and the gap between remembering an answer and finding one.", note: "Explores how reasoning emerges from smaller, reusable skills.", figure: "network", age: "2 hours ago" },
  { id: 2, topic: "Neuroscience", title: "A shared language for biological and artificial neural networks", authors: "L. Rivera & S. Park", summary: "Comparing representations across brains and models reveals surprising similarities in how both organize visual information.", age: "4 hours ago" },
  { id: 3, topic: "Climate science", title: "Learning the rhythm of a changing ocean", authors: "E. Morgan, J. Liu & collaborators", summary: "A data-driven approach to understanding ocean temperature variability across timescales, from seasonal cycles to long-term shifts.", figure: "waves", age: "5 hours ago" },
  { id: 4, topic: "Machine learning", title: "Small models, longer horizons", authors: "R. Shah & T. Wilson", summary: "Rethinking the relationship between model size and planning. This study explores how structured memory can help compact models tackle longer tasks.", note: "A different perspective on scaling: better memory, rather than more parameters.", age: "6 hours ago" },
  { id: 5, topic: "Neuroscience", title: "How the brain decides what to remember", authors: "K. James & collaborators", summary: "New perspectives on the interplay between attention, novelty, and memory consolidation.", figure: "waves", age: "8 hours ago" },
  { id: 6, topic: "Machine learning", title: "Making uncertainty useful in scientific discovery", authors: "D. Kim, A. Singh & collaborators", summary: "Scientific models should know when they might be wrong. An exploration of uncertainty-aware learning for choosing more informative experiments.", age: "10 hours ago" },
  { id: 7, topic: "Climate science", title: "Local signals in a global climate", authors: "N. Brooks & M. Costa", summary: "Connecting global simulations with regional observations to better understand extreme weather. A framework for preserving local detail without losing the bigger picture.", note: "Bridges physical simulation and machine learning.", age: "12 hours ago" },
  { id: 8, topic: "Neuroscience", title: "The geometry of learning", authors: "S. Rao & collaborators", summary: "Following the changing shape of neural representations as new skills become familiar.", figure: "network", age: "1 day ago" },
  { id: 9, topic: "Machine learning", title: "Retrieval as a tool for better scientific questions", authors: "P. Ellis & H. Zhang", summary: "Beyond finding relevant documents: using connections across the literature to surface questions that have yet to be asked.", age: "1 day ago" },
];

function Figure({ kind }: { kind: string }) {
  return <div className={`${styles.figure} ${kind === "waves" ? styles.waves : ""}`} aria-hidden="true">
    <svg viewBox="0 0 320 150" fill="none">
      {kind === "waves" ? Array.from({ length: 7 }, (_, i) => <path key={i} d={`M-10 ${40 + i * 12} C50 ${-25 + i * 16} 85 ${145 - i * 5} 155 ${65 + i * 9} S255 ${15 + i * 12} 335 ${65 + i * 10}`} stroke="currentColor" strokeWidth="1.2" opacity={0.3 + i * 0.09} />) : <>
        {[45, 80, 115].flatMap((y, i) => [30, 60, 90, 120].map((end, j) => <path key={`${i}-${j}`} d={`M70 ${y} L160 ${end} L250 ${45 + (j % 3) * 35}`} stroke="currentColor" opacity=".22" />))}
        {[70, 160, 250].flatMap((x, i) => (i === 1 ? [30, 60, 90, 120] : [45, 80, 115]).map(y => <circle key={`${x}-${y}`} cx={x} cy={y} r="5" fill="var(--bg-primary)" stroke="currentColor" strokeWidth="1.5" />))}
      </>}
    </svg><span>{kind === "waves" ? "Patterns across timescales" : "Connections worth exploring"}</span>
  </div>;
}

export default function FeedsPage() {
  const [interests, setInterests] = useState("");
  const [applied, setApplied] = useState("");
  const [topic, setTopic] = useState("All papers");
  const [saved, setSaved] = useState<number[]>([]);
  const [savedOnly, setSavedOnly] = useState(false);
  const [editing, setEditing] = useState(true);
  const visible = papers.filter(p => (topic === "All papers" || p.topic === topic) && (!savedOnly || saved.includes(p.id)));

  return <div className={styles.page}>
    <PageHeader title="Feeds" />
    <main className={styles.main}>
      <section className={styles.intro}>
        <div className={styles.eyebrow}><span /> A little closer to your next idea</div>
        <h1>Follow your curiosity.</h1>
        <p>The papers you care about, in one place.<br />Tell us what you’re exploring. Make room for something new.</p>
      </section>
      <section className={styles.interests} aria-label="Your research interests">
        <div className={styles.interestHeading}><label htmlFor="interests">What are you interested in?</label><span>Feeds preview</span></div>
        {editing ? <form onSubmit={e => { e.preventDefault(); if (interests.trim()) { setApplied(interests.trim()); setEditing(false); } }}>
          <textarea id="interests" value={interests} onChange={e => setInterests(e.target.value)} placeholder="I’m curious about how AI learns, the neuroscience of memory, and our changing climate…" maxLength={600} rows={2} required />
          <div className={styles.formBottom}><span>Follow a field, a question, or a very specific rabbit hole.</span><button className={styles.primary} disabled={!interests.trim()} type="submit">{applied ? "Update interests" : "Create my feed"}</button></div>
          <div className={styles.suggestions}><span>Try</span>{["Machine learning", "Neuroscience", "Climate science"].map(t => <button key={t} type="button" onClick={() => setInterests(current => current ? `${current.replace(/[., ]+$/, "")}, ${t.toLowerCase()}` : t)}>{t} <span aria-hidden="true">+</span></button>)}</div>
        </form> : <div className={styles.applied}><p id="interests">{applied}</p><button onClick={() => setEditing(true)}>Edit interests</button></div>}
      </section>
      <section className={styles.feed} aria-labelledby="feed-heading">
        <div className={styles.feedHeading}><div><h2 id="feed-heading">{savedOnly ? "Saved papers" : applied ? "Your feed" : "A few things to get curious about"}</h2><p>{applied ? "Your interests are set for this preview. Explore the sample collection below." : "A glimpse of what your reading list could look like."}</p></div><span className={styles.preview}>Sample papers · UI preview</span></div>
        <div className={styles.toolbar}><div className={styles.filters} aria-label="Filter by topic">{topics.map(t => <button key={t} aria-pressed={topic === t} onClick={() => setTopic(t)} className={topic === t ? styles.active : ""}>{t}</button>)}</div><button className={`${styles.savedFilter} ${savedOnly ? styles.active : ""}`} aria-pressed={savedOnly} onClick={() => setSavedOnly(v => !v)}>Saved <span>{saved.length}</span></button></div>
        <div className={styles.resultCount} role="status">{visible.length} sample papers <span>Newest first</span></div>
        <div className={styles.masonry}>
          {visible.map(p => <article className={styles.card} key={p.id}>
            {p.figure && <Figure kind={p.figure} />}
            <div className={styles.cardBody}><div className={styles.cardMeta}><span data-topic={p.topic}>{p.topic}</span><span>{p.age}</span></div><h3>{p.title}</h3><p className={styles.authors}>{p.authors}</p><p className={styles.summary}>{p.summary}</p>{p.note && <div className={styles.note}><span>Why it’s interesting</span><p>{p.note}</p></div>}<div className={styles.cardFooter}><span>Illustrative paper</span><button aria-label={`${saved.includes(p.id) ? "Unsave" : "Save"} ${p.title}`} aria-pressed={saved.includes(p.id)} onClick={() => setSaved(v => v.includes(p.id) ? v.filter(id => id !== p.id) : [...v, p.id])}><svg width="15" height="17" viewBox="0 0 16 18" fill={saved.includes(p.id) ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.3" aria-hidden="true"><path d="M3 2h10v14l-5-3-5 3z" /></svg>{saved.includes(p.id) ? "Saved" : "Save"}</button></div></div>
          </article>)}
        </div>
        {!visible.length && <div className={styles.empty}><h3>Room for your next discovery.</h3><p>{savedOnly ? "Save a paper to keep it here during this visit." : "Choose another topic to explore more papers."}</p><button onClick={() => { setSavedOnly(false); setTopic("All papers"); }}>Explore sample papers</button></div>}
        <p className={styles.endnote}>A preview of a more personal way to explore research.<br />Live paper discovery is coming later.</p>
      </section>
    </main>
  </div>;
}
