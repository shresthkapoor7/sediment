"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { AnimatePresence, m } from "framer-motion";

const ACCEPTED_FILE_TYPES = [
  ".pdf",
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".xlsx",
  ".xls",
  ".ods",
  ".csv",
].join(",");

interface SpecialNoteUploadDialogProps {
  open: boolean;
  usedBytes: number;
  limitBytes: number;
  isUploading: boolean;
  error?: string | null;
  onClose: () => void;
  onFilesSelected: (files: File[]) => void;
}

export function SpecialNoteUploadDialog({
  open,
  usedBytes,
  limitBytes,
  isUploading,
  error,
  onClose,
  onFilesSelected,
}: SpecialNoteUploadDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const isUploadingRef = useRef(isUploading);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    onCloseRef.current = onClose;
    isUploadingRef.current = isUploading;
  }, [isUploading, onClose]);

  useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isUploadingRef.current) onCloseRef.current();
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled])",
      ) ?? []).filter((element) => !element.hidden && element.getClientRects().length > 0);
      if (!focusable.length) return;
      const items = focusable;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    const timer = window.setTimeout(() => dialogRef.current?.querySelector<HTMLElement>("button")?.focus(), 0);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.clearTimeout(timer);
      if (previouslyFocusedRef.current?.isConnected) previouslyFocusedRef.current.focus();
    };
  }, [open]);

  const selectFiles = (files: FileList | null) => {
    const selected = files ? Array.from(files) : [];
    if (selected.length) onFilesSelected(selected);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <AnimatePresence>
      {open && (
        <m.div
          role="presentation"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          onMouseDown={(event) => {
            if (event.currentTarget === event.target && !isUploading) onClose();
          }}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 120,
            display: "grid",
            placeItems: "center",
            padding: "1.5rem",
            background: "color-mix(in srgb, var(--bg-primary) 62%, transparent)",
            backdropFilter: "blur(4px)",
          }}
        >
          <m.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="special-note-dialog-title"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            style={{
              width: "min(100%, 28rem)",
              borderRadius: "14px",
              background: "var(--bg-secondary)",
              boxShadow: "0 24px 60px rgba(0, 0, 0, .28)",
              padding: "18px 18px 16px",
            }}
          >
            <header style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem" }}>
              <div>
                <h2 id="special-note-dialog-title" style={{ color: "var(--text-primary)", fontSize: "15px", fontWeight: 600, letterSpacing: "-0.01em" }}>
                  Attach a file
                </h2>
                <p style={{ maxWidth: "36ch", marginTop: "4px", color: "var(--text-secondary)", fontSize: "13px", lineHeight: 1.5 }}>
                  Keep a private file beside the papers it relates to.
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={isUploading}
                aria-label="Close special note dialog"
                className="sn-ghost"
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                  <path d="m4 4 8 8M12 4l-8 8" />
                </svg>
              </button>
            </header>

            <aside
              role="note"
              style={{
                display: "flex",
                gap: "8px",
                marginTop: "14px",
                color: "var(--text-tertiary)",
              }}
            >
              <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="var(--cat-amber)" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, marginTop: "0.0625rem" }}>
                <path d="M10 3.25 18 17H2l8-13.75Z" />
                <path d="M10 7.25v4.5M10 14.5h.01" />
              </svg>
              <p style={{ fontSize: "12px", lineHeight: 1.5 }}>
                Files are private to you, but don&apos;t upload passwords, financial details or other confidential data.
              </p>
            </aside>

            <div style={{ marginTop: "14px" }}>
              <div aria-hidden="true" style={{ height: "4px", borderRadius: "999px", background: "var(--bg-tertiary)", overflow: "hidden" }}>
                <div style={{ width: `${Math.min(100, (usedBytes / Math.max(limitBytes, 1)) * 100)}%`, height: "100%", borderRadius: "999px", background: "var(--text-secondary)" }} />
              </div>
              <p style={{ marginTop: "6px", color: "var(--text-tertiary)", fontSize: "12px" }}>
                {formatBytes(usedBytes)} of {formatBytes(limitBytes)} used across your files
              </p>
            </div>

            <input
              ref={inputRef}
              type="file"
              accept={ACCEPTED_FILE_TYPES}
              multiple
              hidden
              onChange={(event) => selectFiles(event.currentTarget.files)}
            />
            <section
              aria-label="Choose files to upload"
              onDragEnter={(event) => {
                event.preventDefault();
                if (!isUploading) setIsDragging(true);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={(event) => {
                if (event.currentTarget === event.target) setIsDragging(false);
              }}
              onDrop={(event) => {
                event.preventDefault();
                setIsDragging(false);
                if (!isUploading) selectFiles(event.dataTransfer.files);
              }}
              style={{
                display: "grid",
                placeItems: "center",
                minHeight: "9rem",
                marginTop: "14px",
                borderRadius: "10px",
                background: isDragging ? "color-mix(in srgb, var(--text-primary) 9%, var(--bg-tertiary))" : "var(--bg-tertiary)",
                padding: "1rem",
                textAlign: "center",
                transition: "background 0.16s ease",
              }}
            >
              <div>
                <div style={{ display: "inline-flex", color: "var(--text-tertiary)" }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 20h14" />
                  </svg>
                </div>
                <p style={{ marginTop: "8px", color: "var(--text-primary)", fontSize: "13px", fontWeight: 550 }}>
                  {isUploading ? "Uploading…" : "Drop files here"}
                </p>
                <p style={{ marginTop: "4px", color: "var(--text-tertiary)", fontSize: "12px", lineHeight: 1.45 }}>
                  PDF · JPG · PNG · WebP · GIF · XLSX · XLS · ODS · CSV
                </p>
                <button
                  type="button"
                  disabled={isUploading}
                  onClick={() => inputRef.current?.click()}
                  style={chooseButtonStyle(isUploading)}
                >
                  Choose files
                </button>
              </div>
            </section>

            {error && (
              <p role="alert" style={{ marginTop: "0.75rem", color: "var(--cat-rose)", fontSize: "0.75rem", lineHeight: 1.45 }}>
                {error}
              </p>
            )}
          </m.div>
        </m.div>
      )}
    </AnimatePresence>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(0, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

function chooseButtonStyle(disabled: boolean): CSSProperties {
  return {
    height: "30px",
    marginTop: "12px",
    border: 0,
    borderRadius: "8px",
    background: "var(--accent)",
    color: "var(--on-accent)",
    cursor: disabled ? "default" : "pointer",
    font: "inherit",
    fontSize: "12px",
    fontWeight: 550,
    padding: "0 14px",
    opacity: disabled ? 0.6 : 1,
  };
}
