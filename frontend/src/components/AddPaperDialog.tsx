"use client";

import { useEffect, useRef, useState } from "react";
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

export function AddPaperDialog({ papersOnCanvas, defaultLinkNodeId, onAdd, onClose }: AddPaperDialogProps) {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<SearchState>({ status: "idle" });
  const [linkNodeId, setLinkNodeId] = useState<number | null>(defaultLinkNodeId);
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
  useEffect(() => {
    if (trimmed.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setState({ status: "loading" });
      searchPapers(trimmed, controller.signal)
        .then((papers) => setState({ status: "done", papers }))
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          setState({
            status: "error",
            message: error instanceof APIError ? error.message : "Paper search is unavailable right now.",
          });
        });
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed]);

  const onCanvas = new Set(papersOnCanvas.map((paper) => normalizeId(paper.openalexId)));
  const linkTarget = papersOnCanvas.find((paper) => paper.nodeId === linkNodeId) ?? null;
  const visibleState: SearchState = trimmed.length < 2 ? { status: "idle" } : state;

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
            placeholder="Search papers, or paste a DOI or arXiv link"
            aria-label="Search papers"
            spellCheck={false}
          />
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
            <p className={styles.state}>Find a paper by title or topic and drop it on the canvas.</p>
          )}
          {visibleState.status === "loading" && <p className={styles.state}>Searching…</p>}
          {visibleState.status === "error" && <p className={styles.state}>{visibleState.message}</p>}
          {visibleState.status === "done" && visibleState.papers.length === 0 && (
            <p className={styles.state}>No papers found for “{trimmed}”.</p>
          )}
          {visibleState.status === "done" && visibleState.papers.map((paper) => {
            const added = onCanvas.has(normalizeId(paper.openalexId));
            return (
              <div key={paper.openalexId} className={styles.row}>
                <div className={styles.info}>
                  <div className={styles.title}>{paper.title}</div>
                  <div className={styles.meta}>{describe(paper)}</div>
                  {paper.summary && <div className={styles.summary}>{paper.summary}</div>}
                </div>
                <button
                  type="button"
                  className={styles.add}
                  disabled={added}
                  onClick={() => onAdd(paper, linkTarget?.nodeId ?? null)}
                >
                  {added ? "On canvas" : "Add"}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
