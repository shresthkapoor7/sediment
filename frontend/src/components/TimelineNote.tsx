"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { m } from "framer-motion";
import { SpecialNoteFile, TimelineNote } from "@/lib/types";
import { NOTE_COLOR_OPTIONS, NOTE_KIND_OPTIONS, SPECIAL_NOTE_MIN_HEIGHT, TIMELINE_NOTE_DEFAULT_WIDTH, TIMELINE_NOTE_MIN_HEIGHT, noteColorStyle, noteKindLabel } from "@/lib/note-style";
import { MarkdownContent } from "./MarkdownContent";

interface TimelineNoteCardProps {
  note: TimelineNote;
  connectedNodeCount: number;
  activeNodeId?: number | null;
  isConnectedToActiveNode?: boolean;
  readOnly?: boolean;
  onMove?: (noteId: string, x: number, y: number) => void;
  onResize?: (noteId: string, width: number, height: number) => void;
  onTextChange?: (noteId: string, text: string) => void;
  onKindChange?: (noteId: string, kind: TimelineNote["kind"]) => void;
  onColorChange?: (noteId: string, color: TimelineNote["color"]) => void;
  onToggleActiveConnection?: (noteId: string) => void;
  onDelete?: (noteId: string) => void;
  onOpenSpecialNote?: (note: TimelineNote) => void;
  specialNotePreviewUrl?: string;
  isSpecialNoteDeleting?: boolean;
}

export function TimelineNoteCard({
  note,
  connectedNodeCount,
  activeNodeId,
  isConnectedToActiveNode = false,
  readOnly = false,
  onMove,
  onResize,
  onTextChange,
  onKindChange,
  onColorChange,
  onToggleActiveConnection,
  onDelete,
  onOpenSpecialNote,
  specialNotePreviewUrl,
  isSpecialNoteDeleting = false,
}: TimelineNoteCardProps) {
  const isSpecialNote = note.kind === "special_note" || Boolean(note.specialNote);
  const width = note.width ?? TIMELINE_NOTE_DEFAULT_WIDTH;
  const height = note.height ?? (isSpecialNote ? SPECIAL_NOTE_MIN_HEIGHT : TIMELINE_NOTE_MIN_HEIGHT);
  const colorStyle = noteColorStyle(note.color);
  const cardRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ pointerId: number; clientX: number; clientY: number; x: number; y: number } | null>(null);
  const resizeStartRef = useRef<{ pointerId: number; clientX: number; clientY: number; width: number; height: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [kindMenuOpen, setKindMenuOpen] = useState(false);
  const [isEditingText, setIsEditingText] = useState(false);

  useEffect(() => {
    if (!kindMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && cardRef.current?.contains(target)) return;
      setKindMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setKindMenuOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [kindMenuOpen]);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (readOnly || event.button !== 0) return;
      const target = event.target;
      if (target instanceof Element && target.closest("[data-note-control='true']")) return;
      event.preventDefault();
      event.stopPropagation();
      dragStartRef.current = {
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        x: note.x,
        y: note.y,
      };
      setIsDragging(true);
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [note.x, note.y, readOnly],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const start = dragStartRef.current;
      if (!start || start.pointerId !== event.pointerId || readOnly) return;
      event.preventDefault();
      event.stopPropagation();
      onMove?.(note.id, start.x + event.clientX - start.clientX, start.y + event.clientY - start.clientY);
    },
    [note.id, onMove, readOnly],
  );

  const finishDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const start = dragStartRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    dragStartRef.current = null;
    setIsDragging(false);
  }, []);

  const handleResizePointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (readOnly || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      resizeStartRef.current = {
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        width,
        height,
      };
      setIsResizing(true);
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [height, readOnly, width],
  );

  const handleResizePointerMove = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      const start = resizeStartRef.current;
      if (!start || start.pointerId !== event.pointerId || readOnly) return;
      event.preventDefault();
      event.stopPropagation();
      const nextWidth = Math.max(180, start.width + event.clientX - start.clientX);
      const nextHeight = Math.max(TIMELINE_NOTE_MIN_HEIGHT, start.height + event.clientY - start.clientY);
      onResize?.(note.id, nextWidth, nextHeight);
    },
    [note.id, onResize, readOnly],
  );

  const finishResize = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const start = resizeStartRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    resizeStartRef.current = null;
    setIsResizing(false);
  }, []);

  return (
    <m.div
      ref={cardRef}
      data-canvas-ui="true"
      initial={{ opacity: 0, scale: 0.96, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96, y: 8 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      style={{
        position: "absolute",
        left: note.x,
        top: note.y,
        width,
        height: readOnly && !note.height ? "auto" : height,
        minHeight: readOnly ? undefined : TIMELINE_NOTE_MIN_HEIGHT,
        cursor: readOnly ? "default" : isDragging ? "grabbing" : "grab",
        touchAction: "none",
        zIndex: 4,
      }}
    >
      <div
        style={{
          position: "relative",
          height: readOnly && !note.height ? "auto" : height,
          minHeight: readOnly ? undefined : TIMELINE_NOTE_MIN_HEIGHT,
          borderRadius: "0.375rem",
          border: `0.0625rem solid ${colorStyle.border}`,
          background: colorStyle.background,
          boxShadow: isDragging
            ? "0 1.125rem 2.5rem rgba(0,0,0,0.24), 0 0 0 0.1875rem var(--accent-soft)"
            : "0 0.5rem 1.25rem rgba(0,0,0,0.18)",
          overflow: "visible",
          userSelect: isDragging ? "none" : "auto",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "0.5rem",
            padding: "0.625rem 0.75rem 0",
          }}
        >
          {readOnly || isSpecialNote ? (
            <span
              style={{
                fontSize: "0.625rem",
                fontFamily: "var(--font-mono), monospace",
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: colorStyle.accent,
              }}
            >
              {noteKindLabel(isSpecialNote ? "special_note" : note.kind)}
            </span>
          ) : (
            <div
              data-note-control="true"
              style={{
                position: "relative",
                minWidth: 0,
              }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => setKindMenuOpen((open) => !open)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.35rem",
                  maxWidth: "9.5rem",
                  border: "none",
                  outline: "none",
                  background: "transparent",
                  color: colorStyle.accent,
                  cursor: "pointer",
                  fontSize: "0.625rem",
                  fontFamily: "var(--font-mono), monospace",
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  padding: 0,
                }}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {noteKindLabel(note.kind)}
                </span>
                <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, opacity: 0.8 }}>
                  <path d="M2 3l2 2 2-2" />
                </svg>
              </button>

              {kindMenuOpen && (
                <div
                  role="menu"
                  style={{
                    position: "absolute",
                    top: "calc(100% + 0.45rem)",
                    left: "-0.35rem",
                    width: "11.25rem",
                    padding: "0.35rem",
                    borderRadius: "0.375rem",
                    border: "0.0625rem solid var(--border)",
                    background: "color-mix(in srgb, var(--bg-primary) 98%, transparent)",
                    boxShadow: "0 0.5rem 1.5rem rgba(0,0,0,0.10)",
                    zIndex: 30,
                  }}
                >
                  {NOTE_KIND_OPTIONS.map((kind) => {
                    const selected = (note.kind ?? "field_note") === kind.key;
                    return (
                      <button
                        key={kind.key}
                        type="button"
                        role="menuitemradio"
                        aria-checked={selected}
                        onClick={() => {
                          onKindChange?.(note.id, kind.key);
                          setKindMenuOpen(false);
                        }}
                        style={{
                          width: "100%",
                          display: "grid",
                          gridTemplateColumns: "1rem 1fr",
                          alignItems: "center",
                          gap: "0.5rem",
                          border: "none",
                          borderRadius: "0.5rem",
                          background: selected ? "var(--accent-soft)" : "transparent",
                          color: selected ? "var(--accent)" : "var(--text-secondary)",
                          cursor: "pointer",
                          fontSize: "0.625rem",
                          fontFamily: "var(--font-mono), monospace",
                          letterSpacing: "0.08em",
                          textTransform: "uppercase",
                          textAlign: "left",
                          padding: "0.5rem 0.55rem",
                        }}
                      >
                        <span style={{ width: "1rem", display: "inline-flex", justifyContent: "center" }}>
                          {selected ? "✓" : ""}
                        </span>
                        <span>{kind.shortLabel}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <span
            title={`${connectedNodeCount} connected node${connectedNodeCount === 1 ? "" : "s"}`}
            style={{
              fontSize: "0.625rem",
              fontFamily: "var(--font-mono), monospace",
              color: "var(--text-secondary)",
              whiteSpace: "nowrap",
            }}
          >
            {connectedNodeCount} link{connectedNodeCount === 1 ? "" : "s"}
          </span>
        </div>

        {isSpecialNote && note.specialNote ? (
          <>
            <SpecialNotePreview
              file={note.specialNote}
              previewUrl={specialNotePreviewUrl}
              disabled={readOnly}
              onOpen={() => onOpenSpecialNote?.(note)}
            />
            {!readOnly && isEditingText ? (
              <textarea
                data-note-control="true"
                value={note.text}
                onChange={(event) => onTextChange?.(note.id, event.currentTarget.value)}
                onPointerDown={(event) => event.stopPropagation()}
                onFocus={() => setIsEditingText(true)}
                onBlur={() => setIsEditingText(false)}
                autoFocus
                aria-label="Special note description"
                style={specialNoteTextAreaStyle}
              />
            ) : (
              <button
                data-note-control="true"
                type="button"
                disabled={readOnly}
                onClick={() => {
                  if (!readOnly) setIsEditingText(true);
                }}
                onPointerDown={(event) => event.stopPropagation()}
                style={specialNoteDescriptionStyle(readOnly)}
              >
                <MarkdownContent style={specialNoteDescriptionContentStyle}>
                  {note.text || "Add a description"}
                </MarkdownContent>
              </button>
            )}
          </>
        ) : !readOnly && isEditingText ? (
          <textarea
            data-note-control="true"
            value={note.text}
            onChange={(event) => onTextChange?.(note.id, event.currentTarget.value)}
            onPointerDown={(event) => event.stopPropagation()}
            onFocus={() => setIsEditingText(true)}
            onBlur={() => setIsEditingText(false)}
            autoFocus
            style={{
              position: "relative",
              width: "100%",
              flex: 1,
              minHeight: 0,
              resize: "none",
              border: "none",
              outline: "none",
              background: "transparent",
              color: "var(--text-primary)",
              fontFamily: "var(--font-sans), sans-serif",
              fontSize: "0.9375rem",
              fontWeight: 500,
              lineHeight: 1.5,
              letterSpacing: 0,
              padding: "0.5rem 0.75rem",
              cursor: "text",
            }}
          />
        ) : (
          <button
            data-note-control="true"
            type="button"
            disabled={readOnly}
            onClick={() => {
              if (!readOnly) {
                setIsEditingText(true);
              }
            }}
            onPointerDown={(event) => event.stopPropagation()}
            style={{
              position: "relative",
              width: "100%",
              flex: readOnly && !note.height ? undefined : 1,
              minHeight: 0,
              border: "none",
              background: "transparent",
              textAlign: "left",
              padding: "0.5rem 0.75rem 0.85rem",
              overflow: "auto",
              cursor: readOnly ? "default" : "text",
            }}
          >
            <MarkdownContent
              style={{
                color: "var(--text-primary)",
                fontFamily: "var(--font-sans), sans-serif",
                fontSize: "0.9375rem",
                fontWeight: 500,
                lineHeight: 1.5,
                letterSpacing: 0,
                overflowWrap: "break-word",
              }}
            >
              {note.text || "Add note (markdown supported)"}
            </MarkdownContent>
          </button>
        )}

        {!readOnly && (
          <div
            data-note-control="true"
            style={{
              position: "relative",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "0.5rem",
              padding: "0 0.625rem 0.625rem",
            }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div style={{ display: "flex", gap: "0.25rem" }}>
              {NOTE_COLOR_OPTIONS.map((color) => {
                const selected = (note.color ?? "paper") === color.key;
                return (
                  <button
                    key={color.key}
                    type="button"
                    title={`Set note ${color.label.toLowerCase()}`}
                    aria-label={`Set note ${color.label.toLowerCase()}`}
                    onClick={() => onColorChange?.(note.id, color.key)}
                    style={{
                      width: "1rem",
                      height: "1rem",
                      borderRadius: "999px",
                      border: `0.09375rem solid ${selected ? "var(--text-primary)" : "var(--border)"}`,
                      background: color.accent,
                      cursor: "pointer",
                      opacity: selected ? 1 : 0.72,
                    }}
                  />
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => onDelete?.(note.id)}
              disabled={isSpecialNoteDeleting}
              style={{
                background: "transparent",
                border: "none",
                color: isSpecialNoteDeleting ? "var(--text-tertiary)" : "var(--cat-rose)",
                cursor: isSpecialNoteDeleting ? "default" : "pointer",
                fontSize: "0.625rem",
                fontFamily: "var(--font-mono), monospace",
                letterSpacing: "0.04em",
                padding: "0.125rem",
              }}
            >
              {isSpecialNoteDeleting ? "Deleting…" : isSpecialNote ? "Delete file" : "Delete"}
            </button>
          </div>
        )}

        {!readOnly && activeNodeId && (
          <button
            data-note-control="true"
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onToggleActiveConnection?.(note.id)}
            style={{
              position: "relative",
              width: "calc(100% - 1.25rem)",
              margin: "0 0.625rem 0.625rem",
              border: `0.0625rem solid ${isConnectedToActiveNode ? colorStyle.accent : "var(--border)"}`,
              borderRadius: "0.25rem",
              background: isConnectedToActiveNode ? "color-mix(in srgb, var(--accent-soft) 72%, transparent)" : "var(--bg-primary)",
              color: isConnectedToActiveNode ? "var(--accent)" : "var(--text-secondary)",
              cursor: "pointer",
              fontSize: "0.625rem",
              fontFamily: "var(--font-mono), monospace",
              letterSpacing: "0.04em",
              padding: "0.375rem 0.5rem",
              textTransform: "uppercase",
            }}
          >
            {isConnectedToActiveNode ? "Unlink selected paper" : "Link selected paper"}
          </button>
        )}

        {!readOnly && (
          <button
            data-note-control="true"
            type="button"
            aria-label="Resize note"
            title="Resize note"
            onPointerDown={handleResizePointerDown}
            onPointerMove={handleResizePointerMove}
            onPointerUp={finishResize}
            onPointerCancel={finishResize}
            style={{
              position: "absolute",
              right: "0.5rem",
              bottom: "0.5rem",
              width: "1rem",
              height: "1rem",
              border: "none",
              background: "transparent",
              cursor: isResizing ? "nwse-resize" : "nwse-resize",
              padding: 0,
              color: "var(--text-tertiary)",
            }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M6 13L13 6" />
              <path d="M10 13L13 10" />
            </svg>
          </button>
        )}
      </div>
    </m.div>
  );
}

function SpecialNotePreview({
  file,
  previewUrl,
  disabled,
  onOpen,
}: {
  file: SpecialNoteFile;
  previewUrl?: string;
  disabled: boolean;
  onOpen: () => void;
}) {
  const label = file.fileType === "pdf" ? "PDF" : file.fileType === "spreadsheet" ? "SHEET" : "IMAGE";
  const accent = file.fileType === "pdf" ? "var(--cat-rose)" : file.fileType === "spreadsheet" ? "var(--cat-green)" : "var(--cat-blue)";

  return (
    <button
      data-note-control="true"
      type="button"
      disabled={disabled}
      onClick={onOpen}
      onPointerDown={(event) => event.stopPropagation()}
      title={disabled ? file.filename : `Open ${file.filename}`}
      style={{
        position: "relative",
        display: "block",
        width: "calc(100% - 1.5rem)",
        minHeight: "8.5rem",
        margin: "0.625rem 0.75rem 0",
        overflow: "hidden",
        border: "0.0625rem solid var(--border)",
        borderRadius: "0.5rem",
        background: "var(--bg-tertiary)",
        color: "var(--text-primary)",
        cursor: disabled ? "default" : "pointer",
        textAlign: "left",
      }}
    >
      {file.fileType === "image" && previewUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- Signed Supabase Storage URLs cannot use Next image optimization.
        <img
          src={previewUrl}
          alt={`Preview of ${file.filename}`}
          style={{ width: "100%", height: "8.5rem", objectFit: "cover" }}
        />
      ) : (
        <div
          aria-hidden="true"
          style={{
            display: "grid",
            height: "8.5rem",
            placeItems: "center",
            background: `linear-gradient(135deg, color-mix(in srgb, ${accent} 12%, var(--bg-secondary)), var(--bg-tertiary))`,
          }}
        >
          {file.fileType === "spreadsheet" ? <SpreadsheetGlyph color={accent} /> : <DocumentGlyph color={accent} />}
        </div>
      )}
      <span
        style={{
          position: "absolute",
          top: "0.5rem",
          left: "0.5rem",
          borderRadius: "999px",
          background: "color-mix(in srgb, var(--bg-primary) 88%, transparent)",
          color: accent,
          fontFamily: "var(--font-mono), monospace",
          fontSize: "0.5625rem",
          fontWeight: 700,
          letterSpacing: "0.09em",
          padding: "0.25rem 0.375rem",
        }}
      >
        {label}
      </span>
      {!disabled && (
        <span
          style={{
            position: "absolute",
            right: "0.5rem",
            bottom: "0.5rem",
            borderRadius: "0.375rem",
            background: "color-mix(in srgb, var(--bg-primary) 92%, transparent)",
            color: "var(--text-primary)",
            fontFamily: "var(--font-mono), monospace",
            fontSize: "0.5625rem",
            letterSpacing: "0.04em",
            padding: "0.25rem 0.375rem",
          }}
        >
          VIEW
        </span>
      )}
      <span
        style={{
          position: "absolute",
          right: disabled ? "0.625rem" : "3.75rem",
          bottom: "0.625rem",
          left: "0.625rem",
          overflow: "hidden",
          color: "var(--text-primary)",
          fontFamily: "var(--font-sans), sans-serif",
          fontSize: "0.75rem",
          fontWeight: 600,
          lineHeight: 1.3,
          textOverflow: "ellipsis",
          textShadow: "0 0.0625rem 0.5rem var(--bg-primary)",
          whiteSpace: "nowrap",
        }}
      >
        {file.filename}
      </span>
    </button>
  );
}

function DocumentGlyph({ color }: { color: string }) {
  return (
    <svg width="47" height="58" viewBox="0 0 47 58" fill="none" aria-hidden="true">
      <path d="M9 2h20l9 9v43a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z" fill="var(--bg-primary)" stroke={color} strokeWidth="1.5" />
      <path d="M29 2v10h9M14 28h17M14 35h17M14 42h12" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function SpreadsheetGlyph({ color }: { color: string }) {
  return (
    <svg width="58" height="52" viewBox="0 0 58 52" fill="none" aria-hidden="true">
      <rect x="2" y="2" width="54" height="48" rx="4" fill="var(--bg-primary)" stroke={color} strokeWidth="1.5" />
      <path d="M2 15h54M17 15v35M35 15v35M2 32h54" stroke={color} strokeWidth="1.35" />
      <path d="M8 8h7" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

const specialNoteTextAreaStyle: CSSProperties = {
  position: "relative",
  width: "100%",
  flex: 1,
  minHeight: "2.5rem",
  resize: "none",
  border: "none",
  outline: "none",
  background: "transparent",
  color: "var(--text-primary)",
  fontFamily: "var(--font-sans), sans-serif",
  fontSize: "0.75rem",
  lineHeight: 1.45,
  padding: "0.5rem 0.75rem",
  cursor: "text",
};

function specialNoteDescriptionStyle(readOnly: boolean): CSSProperties {
  return {
    position: "relative",
    width: "100%",
    flex: 1,
    minHeight: "2.5rem",
    border: "none",
    background: "transparent",
    textAlign: "left",
    padding: "0.5rem 0.75rem",
    overflow: "auto",
    cursor: readOnly ? "default" : "text",
  };
}

const specialNoteDescriptionContentStyle: CSSProperties = {
  color: "var(--text-secondary)",
  fontFamily: "var(--font-sans), sans-serif",
  fontSize: "0.75rem",
  lineHeight: 1.45,
  overflowWrap: "break-word",
};
