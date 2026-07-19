"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { MarkdownContent } from "./MarkdownContent";
import { PaperContentResponse } from "@/lib/types";

interface PaperReaderModalProps {
  open: boolean;
  content: PaperContentResponse | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onAskSediment: (excerpt: string) => void;
}

interface SelectedQuote {
  text: string;
  top: number;
  left: number;
}

interface SelectionHighlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PAPER_READER_SELECTION_HIGHLIGHT = "sediment-paper-reader-selection";

export function PaperReaderModal({ open, content, loading, error, onClose, onAskSediment }: PaperReaderModalProps) {
  const readerRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const selectedRangeRef = useRef<Range | null>(null);
  const [mounted, setMounted] = useState(false);
  const [selectedQuote, setSelectedQuote] = useState<SelectedQuote | null>(null);
  const [selectionHighlightRects, setSelectionHighlightRects] = useState<SelectionHighlightRect[]>([]);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  useEffect(() => {
    if (!open || !mounted) return;
    previouslyFocusedRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const focusTimer = window.setTimeout(() => closeButtonRef.current?.focus(), 0);
    const backgroundElements = (Array.from(document.body.children) as HTMLElement[])
      .filter((element) => element !== overlayRef.current)
      .map((element) => ({
        element,
        inert: element.inert,
        ariaHidden: element.getAttribute("aria-hidden"),
      }));
    for (const { element } of backgroundElements) {
      element.inert = true;
      element.setAttribute("aria-hidden", "true");
    }

    return () => {
      window.clearTimeout(focusTimer);
      for (const { element, inert, ariaHidden } of backgroundElements) {
        element.inert = inert;
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
      }
      previouslyFocusedRef.current?.focus();
    };
  }, [mounted, open]);

  const markdown = content ? chunksToMarkdown(content) : "";
  const clearSelectionHighlight = useCallback(() => {
    selectedRangeRef.current = null;
    setSelectionHighlightRects([]);
    if (typeof CSS !== "undefined" && "highlights" in CSS) {
      CSS.highlights.delete(PAPER_READER_SELECTION_HIGHLIGHT);
    }
  }, []);

  useEffect(() => clearSelectionHighlight, [clearSelectionHighlight]);

  const restoreSelectedRange = useCallback(() => {
    const range = selectedRangeRef.current;
    const readerContent = contentRef.current;
    if (!range || !readerContent || !readerContent.contains(range.commonAncestorContainer)) return;
    const selection = window.getSelection();
    if (!selection) return;
    selection.removeAllRanges();
    selection.addRange(range);
  }, []);

  const updateSelectedQuote = useCallback(() => {
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const reader = readerRef.current;
    const readerContent = contentRef.current;
    if (!selection || !range || selection.isCollapsed || !reader || !readerContent) {
      clearSelectionHighlight();
      setSelectedQuote(null);
      return;
    }

    const commonAncestor = range.commonAncestorContainer.nodeType === Node.TEXT_NODE
      ? range.commonAncestorContainer.parentElement
      : range.commonAncestorContainer;
    if (!(commonAncestor instanceof Node) || !readerContent.contains(commonAncestor)) {
      clearSelectionHighlight();
      setSelectedQuote(null);
      return;
    }

    const text = selection.toString().trim();
    const rect = range.getBoundingClientRect();
    if (!text || (!rect.width && !rect.height)) {
      clearSelectionHighlight();
      setSelectedQuote(null);
      return;
    }
    const selectedRange = range.cloneRange();
    selectedRangeRef.current = selectedRange;
    if (typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined") {
      CSS.highlights.set(PAPER_READER_SELECTION_HIGHLIGHT, new Highlight(selectedRange));
    }
    const readerRect = reader.getBoundingClientRect();
    const contentRect = readerContent.getBoundingClientRect();
    setSelectionHighlightRects(Array.from(range.getClientRects())
      .filter((selectionRect) => selectionRect.width && selectionRect.height)
      .map((selectionRect) => ({
        top: selectionRect.top - contentRect.top + readerContent.scrollTop,
        left: selectionRect.left - contentRect.left + readerContent.scrollLeft,
        width: selectionRect.width,
        height: selectionRect.height,
      })));
    setSelectedQuote({
      text: text.slice(0, 6_000),
      top: Math.max(0.75 * 16, rect.top - readerRect.top - 0.5 * 16),
      left: Math.min(Math.max(0.75 * 16, rect.left - readerRect.left), readerRect.width - 8.5 * 16),
    });
    window.requestAnimationFrame(restoreSelectedRange);
  }, [clearSelectionHighlight, restoreSelectedRange]);

  const trapFocus = useCallback((event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab") return;
    const reader = readerRef.current;
    if (!reader) return;
    const focusable = Array.from(reader.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )).filter((element) => !element.hasAttribute("hidden") && element.getClientRects().length > 0);
    if (!focusable.length) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !reader.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !reader.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }, []);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          ref={overlayRef}
          data-canvas-ui="true"
          role="presentation"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onMouseDown={onClose}
          onWheelCapture={(event) => event.stopPropagation()}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "1.5rem",
            background: "rgba(8, 7, 5, 0.62)",
            backdropFilter: "blur(0.75rem)",
            WebkitBackdropFilter: "blur(0.75rem)",
          }}
        >
          <motion.section
            ref={readerRef}
            role="dialog"
            aria-modal="true"
            aria-label={content ? `Read ${content.title}` : "Paper reader"}
            initial={{ opacity: 0, y: 20, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.985 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            onMouseDown={(event) => event.stopPropagation()}
            onWheelCapture={(event) => event.stopPropagation()}
            onKeyDown={trapFocus}
            style={{
              position: "relative",
              width: "min(54rem, 100%)",
              height: "min(48rem, 100%)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              borderRadius: "1rem",
              border: "0.0625rem solid var(--border-hover)",
              background: "var(--bg-primary)",
              boxShadow: "0 1.5rem 5rem rgba(0,0,0,0.48)",
            }}
          >
            <header
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "0.625rem",
                padding: "0.625rem 0.875rem",
                borderBottom: "0.0625rem solid var(--border)",
                background: "color-mix(in srgb, var(--bg-secondary) 80%, transparent)",
                flexShrink: 0,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <h1
                  style={{
                    margin: 0,
                    color: "var(--text-primary)",
                    fontFamily: "'DM Sans', sans-serif",
                    fontSize: "1rem",
                    lineHeight: 1.35,
                    fontWeight: 650,
                  }}
                >
                  {content?.sourceUrl ? (
                    <a
                      href={content.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Open source"
                      style={{
                        color: "inherit",
                        textDecoration: "underline",
                        textDecorationColor: "var(--accent)",
                        textDecorationThickness: "0.1em",
                        textUnderlineOffset: "0.18em",
                      }}
                    >
                      {content.title}
                    </a>
                  ) : (content?.title ?? "Opening paper")}
                </h1>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close paper reader"
                ref={closeButtonRef}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "1.75rem",
                  height: "1.75rem",
                  padding: 0,
                  flexShrink: 0,
                  border: "0.0625rem solid var(--border)",
                  borderRadius: "0.5rem",
                  background: "var(--bg-primary)",
                  color: "var(--text-secondary)",
                  cursor: "pointer",
                }}
              >
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
                  <path d="m3 3 10 10M13 3 3 13" />
                </svg>
              </button>
            </header>

            <div
              ref={contentRef}
              onPointerUp={() => window.requestAnimationFrame(updateSelectedQuote)}
              onKeyUp={() => window.requestAnimationFrame(updateSelectedQuote)}
              onScroll={() => {
                clearSelectionHighlight();
                setSelectedQuote(null);
              }}
              style={{
                flex: 1,
                position: "relative",
                overflowY: "auto",
                padding: "1.5rem clamp(1.25rem, 5vw, 3.5rem) 3rem",
                color: "var(--text-secondary)",
                fontFamily: "'DM Sans', sans-serif",
                fontSize: "0.9375rem",
                lineHeight: 1.78,
              }}
            >
              {selectionHighlightRects.map((selectionRect, index) => (
                <span
                  aria-hidden="true"
                  key={`${selectionRect.top}-${selectionRect.left}-${index}`}
                  style={{
                    position: "absolute",
                    top: `${selectionRect.top}px`,
                    left: `${selectionRect.left}px`,
                    width: `${selectionRect.width}px`,
                    height: `${selectionRect.height}px`,
                    borderRadius: "0.125rem",
                    background: "color-mix(in srgb, var(--accent) 32%, transparent)",
                    pointerEvents: "none",
                    zIndex: 0,
                  }}
                />
              ))}
              {loading && <PaperReaderLoading />}
              {error && (
                <div
                  role="alert"
                  style={{
                    maxWidth: "35rem",
                    margin: "3rem auto",
                    padding: "1rem 1.125rem",
                    borderRadius: "0.75rem",
                    border: "0.0625rem solid var(--border)",
                    background: "var(--bg-secondary)",
                    color: "var(--text-secondary)",
                  }}
                >
                  {error}
                </div>
              )}
              {!loading && !error && content && (
                <article style={{ position: "relative", zIndex: 1, maxWidth: "43rem", margin: "0 auto" }}>
                  <MarkdownContent>{markdown}</MarkdownContent>
                  {content.truncated && (
                    <p
                      style={{
                        margin: "2rem 0 0",
                        color: "var(--text-tertiary)",
                        fontSize: "0.8125rem",
                        fontStyle: "italic",
                      }}
                    >
                      This preview contains the first 100 cached chunks of the paper.
                    </p>
                  )}
                </article>
              )}
            </div>
            {selectedQuote && (
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onAskSediment(selectedQuote.text);
                  clearSelectionHighlight();
                  setSelectedQuote(null);
                }}
                style={{
                  position: "absolute",
                  top: `${selectedQuote.top}px`,
                  left: `${selectedQuote.left}px`,
                  zIndex: 2,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.375rem",
                  padding: "0.4rem 0.625rem",
                  border: "0.0625rem solid var(--border-hover)",
                  borderRadius: "0.5rem",
                  background: "var(--bg-primary)",
                  color: "var(--text-primary)",
                  boxShadow: "0 0.5rem 1.5rem rgba(0,0,0,0.32)",
                  fontFamily: "'DM Sans', sans-serif",
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M2 5.5h8.5M7 2l3.5 3.5L7 9" />
                </svg>
                Ask Sediment
              </button>
            )}
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

function chunksToMarkdown(content: PaperContentResponse): string {
  let previousSection = "";
  const blocks: string[] = [];
  for (const chunk of content.chunks) {
    const section = chunk.section?.trim() || "";
    if (section && section !== previousSection) {
      blocks.push(`## ${section}`);
      previousSection = section;
    }
    if (chunk.content.trim()) blocks.push(recoverFlattenedTable(chunk.content.trim()));
  }
  return blocks.join("\n\n");
}

function recoverFlattenedTable(text: string): string {
  const dividerIndex = text.search(/\|(?:\s*:?-{3,}:?\s*\|){2,}/);
  if (dividerIndex < 0) return text;

  const beforeDivider = text.slice(0, dividerIndex);
  const lastSentenceEnd = Math.max(
    beforeDivider.lastIndexOf(". "),
    beforeDivider.lastIndexOf(": "),
    beforeDivider.lastIndexOf("\n"),
  );
  const tableStart = text.indexOf("|||", lastSentenceEnd + 1);
  if (tableStart < 0) return text;

  const beforeTable = text.slice(0, tableStart).trimEnd();
  const table = `|${text.slice(tableStart + 3)}`
    .replace(/\|{2,}(?=\s*:?-{3,}:?)/g, "|\n|")
    .replace(/\|{3,}/g, "|\n|")
    .replace(/\|\s*(Table\s+\d+\s*:)/gi, "|\n\n$1");
  return `${beforeTable}\n\n${table}`;
}

function PaperReaderLoading() {
  return (
    <div style={{ maxWidth: "43rem", margin: "0 auto", display: "grid", gap: "0.875rem" }}>
      {["72%", "100%", "93%", "97%", "64%", "100%", "86%"].map((width, index) => (
        <div
          key={`${width}-${index}`}
          style={{
            width,
            height: "0.875rem",
            borderRadius: "999px",
            background: "var(--bg-secondary)",
            opacity: 0.9 - index * 0.06,
          }}
        />
      ))}
    </div>
  );
}
