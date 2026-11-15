"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { APIError, searchPapers } from "@/lib/api";
import { GraphPaper } from "@/lib/types";
import styles from "./AddPaperDialog.module.css";

export interface CanvasPaperOption {
  nodeId: number;
  openalexId: string;
  title: string;
  year: number;
}

interface AddPaperDialogProps {
  papersOnCanvas: CanvasPaperOption[];
  /** The paper to pre-select in "Link to", usually the one that is open. */
  defaultLinkNodeId: number | null;
  onAdd: (paper: GraphPaper, linkToNodeId: number | null) => void;
  onClose: () => void;
}

type SearchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; papers: GraphPaper[] }
  | { status: "error"; message: string };

const normalizeId = (value: string) => value.trim().split("/").pop()?.toUpperCase() ?? "";

function formatCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(count >= 10_000 ? 0 : 1).replace(/\.0$/, "")}K`;
  return String(count);
}

function describe(paper: GraphPaper): string {
  const authors = paper.authors ?? [];
  const names = authors.length > 2 ? `${authors.slice(0, 2).join(", ")} +${authors.length - 2}` : authors.join(", ");
  return [
    names,
    paper.year ? String(paper.year) : "",
    paper.citedByCount ? `${formatCount(paper.citedByCount)} cited` : "",
  ].filter(Boolean).join(" · ");
}

function doiHref(doi: string): string {
  return /^https?:\/\//i.test(doi) ? doi : `https://doi.org/${doi.replace(/^doi:/i, "")}`;
}

/** What a result is about: the whole abstract and the details the one-line row leaves out. */
function PaperPreview({ paper }: { paper: GraphPaper }) {
  const authors = paper.authors ?? [];
  const facts = [paper.type, paper.year ? String(paper.year) : "", paper.referencesCount ? `${paper.referencesCount} references` : ""].filter(Boolean);
  const abstract = (paper.detail || paper.summary || "").trim();
  const links = [
    paper.doi ? { label: "DOI", href: doiHref(paper.doi) } : null,
    paper.oaUrl ? { label: "Open access", href: paper.oaUrl } : null,
    { label: "OpenAlex", href: `https://openalex.org/${normalizeId(paper.openalexId)}` },
  ].filter((link): link is { label: string; href: string } => link !== null);
  return (
    <div className={styles.preview}>
      {authors.length > 0 && <div className={styles.previewAuthors}>{authors.join(", ")}</div>}
      {facts.length > 0 && <div className={styles.previewFacts}>{facts.join(" · ")}</div>}
      <p className={styles.previewAbstract}>{abstract || "OpenAlex has no abstract for this paper."}</p>
      {(paper.concepts ?? []).length > 0 && (
        <div className={styles.previewTags}>
          {(paper.concepts ?? []).slice(0, 6).map((concept) => <span key={concept}>{concept}</span>)}
        </div>
      )}
      <div className={styles.previewLinks}>
        {links.map((link) => (
          <a key={link.label} href={link.href} target="_blank" rel="noopener noreferrer">{link.label} ↗</a>
        ))}
      </div>
    </div>
  );
}

export function AddPaperDialog({ papersOnCanvas, defaultLinkNodeId, onAdd, onClose }: AddPaperDialogProps) {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<SearchState>({ status: "idle" });
  const [linkNodeId, setLinkNodeId] = useState<number | null>(defaultLinkNodeId);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [mode, setMode] = useState<"keyword" | "semantic">("keyword");
  const [semanticRequest, setSemanticRequest] = useState<{ query: string; nonce: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  const trimmed = query.trim();

  const runSearch = useCallback((text: string, searchMode: "keyword" | "semantic", signal: AbortSignal) => {
    searchPapers(text, signal, searchMode)
      .then((papers) => setState({ status: "done", papers }))
      .catch((error: unknown) => {
        if (signal.aborted) return;
        setState({
          status: "error",
          message: error instanceof APIError ? error.message : "Paper search is unavailable right now.",
        });
      });
  }, []);

  // Keyword search follows the typing.
  useEffect(() => {
    if (mode !== "keyword" || trimmed.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setState({ status: "loading" });
      runSearch(trimmed, "keyword", controller.signal);
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed, mode, runSearch]);

  // Semantic search is slower and rate limited, so it only runs when the researcher asks for it.
  useEffect(() => {
    if (mode !== "semantic" || !semanticRequest) return;
    const controller = new AbortController();
    runSearch(semanticRequest.query, "semantic", controller.signal);
    return () => controller.abort();
  }, [mode, semanticRequest, runSearch]);

  function submitSemantic() {
    if (trimmed.length < 2) return;
    setState({ status: "loading" });
    setSemanticRequest((previous) => ({ query: trimmed, nonce: (previous?.nonce ?? 0) + 1 }));
  }

  function chooseMode(next: "keyword" | "semantic") {
    if (next === mode) return;
    setMode(next);
    setSemanticRequest(null);
    setPreviewId(null);
    setState({ status: "idle" });
    inputRef.current?.focus();
  }

  const onCanvas = new Set(papersOnCanvas.map((paper) => normalizeId(paper.openalexId)));
  const linkTarget = papersOnCanvas.find((paper) => paper.nodeId === linkNodeId) ?? null;
  const visibleState: SearchState = mode === "semantic"
    ? (semanticRequest ? state : { status: "idle" })
    : trimmed.length < 2 ? { status: "idle" } : state;
  const shownQuery = mode === "semantic" ? semanticRequest?.query ?? "" : trimmed;

  return (
    <div
      className={styles.backdrop}
      data-canvas-ui="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onWheel={(event) => event.stopPropagation()}
    >
      <div className={styles.panel} role="dialog" aria-modal="true" aria-label="Add a paper">
        <div className={styles.search}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
            <circle cx="7" cy="7" r="4.5" />
            <path d="m10.5 10.5 3 3" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (mode === "semantic" && event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                submitSemantic();
              }
            }}
            placeholder={mode === "semantic" ? "Describe what you are looking for" : "Search papers, or paste a DOI or arXiv link"}
            aria-label="Search papers"
            spellCheck={false}
          />
          <div className={styles.modes} role="group" aria-label="Search type">
            <button
              type="button"
              aria-pressed={mode === "keyword"}
              title="Match the words you type in titles, abstracts and keywords"
              onClick={() => chooseMode("keyword")}
            >
              Keyword
            </button>
            <button
              type="button"
              aria-pressed={mode === "semantic"}
              title="Describe an idea in your own words; results are matched by meaning"
              onClick={() => chooseMode("semantic")}
            >
              Semantic
            </button>
          </div>
          {mode === "semantic" && (
            <button
              type="button"
              className={styles.searchButton}
              title="Search (Enter)"
              aria-label="Search"
              disabled={trimmed.length < 2}
              onClick={submitSemantic}
            >
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                <circle cx="7" cy="7" r="4.5" />
                <path d="m10.5 10.5 3 3" />
              </svg>
            </button>
          )}
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
              <path d="M2 2l8 8M10 2l-8 8" />
            </svg>
          </button>
        </div>

        {papersOnCanvas.length > 0 && (
          <label className={styles.link}>
            Link to
            <select
              value={linkNodeId ?? ""}
              onChange={(event) => setLinkNodeId(event.target.value ? Number(event.target.value) : null)}
            >
              <option value="">Nothing, leave it on its own</option>
              {papersOnCanvas.map((paper) => (
                <option key={paper.nodeId} value={paper.nodeId}>
                  {paper.year ? `${paper.title} (${paper.year})` : paper.title}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className={styles.results}>
          {visibleState.status === "idle" && (
            <p className={styles.state}>
              {mode === "semantic"
                ? "Describe an idea or question, then press Enter. You get papers that are about it, even if they use different words."
                : "Find a paper by title or topic and drop it on the canvas."}
            </p>
          )}
          {visibleState.status === "loading" && <p className={styles.state}>Searching…</p>}
          {visibleState.status === "error" && <p className={styles.state}>{visibleState.message}</p>}
          {visibleState.status === "done" && visibleState.papers.length === 0 && (
            <p className={styles.state}>No papers found for “{shownQuery}”.</p>
          )}
          {visibleState.status === "done" && visibleState.papers.map((paper) => {
            const added = onCanvas.has(normalizeId(paper.openalexId));
            const previewing = previewId === paper.openalexId;
            return (
              <div key={paper.openalexId} className={styles.row}>
                <div className={styles.info}>
                  <div className={styles.title}>{paper.title}</div>
                  <div className={styles.meta}>{describe(paper)}</div>
                  {!previewing && paper.summary && <div className={styles.summary}>{paper.summary}</div>}
                  {previewing && <PaperPreview paper={paper} />}
                </div>
                <div className={styles.actions}>
                  <button
                    type="button"
                    className={styles.previewButton}
                    title={previewing ? "Hide preview" : "Preview"}
                    aria-label={previewing ? "Hide preview" : "Preview paper"}
                    aria-expanded={previewing}
                    onClick={() => setPreviewId(previewing ? null : paper.openalexId)}
                  >
                    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M1 8s3-5 7-5 7 5 7 5-3 5-7 5-7-5-7-5z" />
                      <circle cx="8" cy="8" r="2" />
                      {previewing && <path d="M2 2l12 12" />}
                    </svg>
                  </button>
                  <button
                    type="button"
                    className={styles.add}
                    disabled={added}
                    title={added ? "Already on the canvas" : "Add to canvas"}
                    aria-label={added ? "Already on the canvas" : `Add ${paper.title} to the canvas`}
                    onClick={() => onAdd(paper, linkTarget?.nodeId ?? null)}
                  >
                    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      {added ? <path d="m3.5 8.5 3 3 6-7" /> : <path d="M8 3v10M3 8h10" />}
                    </svg>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
