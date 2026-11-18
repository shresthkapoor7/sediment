"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, m } from "framer-motion";
import { SpecialNoteFile } from "@/lib/types";
import { SpreadsheetPreview } from "./SpreadsheetPreview";

interface SpecialNoteViewerModalProps {
  file: SpecialNoteFile | null;
  url: string | null;
  onClose: () => void;
}

export function SpecialNoteViewerModal({ file, url, onClose }: SpecialNoteViewerModalProps) {
  const viewerRef = useRef<HTMLElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Portals can only render after the browser document exists.
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!file) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [file, onClose]);

  useEffect(() => {
    if (!file || !mounted) return;
    previouslyFocusedRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
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
  }, [file, mounted]);

  const trapFocus = useCallback((event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab") return;
    const viewer = viewerRef.current;
    if (!viewer) return;
    const focusable = Array.from(viewer.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )).filter((element) => !element.hasAttribute("hidden") && element.getClientRects().length > 0);
    if (!focusable.length) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !viewer.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !viewer.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }, []);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {file && url && (
        <m.div
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
            background: "color-mix(in srgb, var(--bg-primary) 62%, transparent)",
            backdropFilter: "blur(4px)",
          }}
        >
          <m.section
            ref={viewerRef}
            role="dialog"
            aria-modal="true"
            aria-label={`Preview ${file.filename}`}
            initial={{ opacity: 0, y: 20, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.985 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            onMouseDown={(event) => event.stopPropagation()}
            onWheelCapture={(event) => event.stopPropagation()}
            onKeyDown={trapFocus}
            style={{
              width: "min(64rem, 100%)",
              height: "min(52rem, 100%)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              borderRadius: "14px",
              background: "var(--bg-secondary)",
              boxShadow: "0 24px 60px rgba(0, 0, 0, .28)",
            }}
          >
            <header
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.375rem",
                padding: "12px 12px 10px 18px",
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <p
                  style={{
                    overflow: "hidden",
                    margin: 0,
                    color: "var(--text-primary)",
                    fontFamily: "inherit",
                    fontSize: "14px",
                    fontWeight: 550,
                    letterSpacing: "-0.01em",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {file.filename}
                </p>
                <p
                  style={{
                    margin: "0.125rem 0 0",
                    color: "var(--text-tertiary)",
                    fontSize: "12px",
                  }}
                >
                  {file.fileType === "spreadsheet" ? "Spreadsheet" : file.fileType === "pdf" ? "PDF" : "Image"}
                </p>
              </div>
              <a href={url} download={file.filename} className="sn-ghost sn-ghost-text">
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 2.5v7.5M5 7.5l3 3 3-3M3 13h10" /></svg>
                Download
              </a>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={onClose}
                aria-label="Close special note preview"
                className="sn-ghost"
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                  <path d="m4 4 8 8M12 4l-8 8" />
                </svg>
              </button>
            </header>

            <div
              style={{
                minHeight: 0,
                flex: 1,
                display: file.fileType === "spreadsheet" ? "flex" : "grid",
                placeItems: "center",
                overflow: "auto",
                margin: "0 8px 8px",
                borderRadius: "10px",
                background: "var(--bg-tertiary)",
              }}
            >
              {file.fileType === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element -- Signed Supabase Storage URLs cannot use Next image optimization.
                <img
                  src={url}
                  alt={`Preview of ${file.filename}`}
                  style={{ display: "block", maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
                />
              ) : file.fileType === "pdf" ? (
                <iframe
                  title={`Preview of ${file.filename}`}
                  src={url}
                  sandbox=""
                  referrerPolicy="no-referrer"
                  style={{ display: "block", width: "100%", height: "100%", border: "none", background: "var(--bg-primary)" }}
                />
              ) : (
                <SpreadsheetPreview filename={file.filename} url={url} />
              )}
            </div>
          </m.section>
        </m.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
