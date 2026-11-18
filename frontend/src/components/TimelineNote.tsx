"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { m } from "framer-motion";
import { SpecialNoteFile, TimelineNote } from "@/lib/types";
import { NOTE_COLOR_OPTIONS, NOTE_KIND_OPTIONS, SPECIAL_NOTE_MIN_HEIGHT, TIMELINE_NOTE_DEFAULT_WIDTH, TIMELINE_NOTE_MIN_HEIGHT, isSpecialNote, noteColorStyle, noteKindLabel } from "@/lib/note-style";
import { MarkdownContent } from "./MarkdownContent";
import bar from "./TimelineNode.module.css";

interface TimelineNoteCardProps {
  note: TimelineNote;
  connectedNodeCount: number;
  activeNodeId?: number | null;
  isConnectedToActiveNode?: boolean;
  readOnly?: boolean;
  onMove?: (noteId: string, x: number, y: number) => void;
  /** The drag ended. */
  onMoveEnd?: () => void;
  /** Current canvas zoom, so drags and resizes cover the same distance as the pointer. */
  getZoom?: () => number;
  onResize?: (noteId: string, width: number, height: number) => void;
  onTextChange?: (noteId: string, text: string) => void;
  onKindChange?: (noteId: string, kind: TimelineNote["kind"]) => void;
  onColorChange?: (noteId: string, color: TimelineNote["color"]) => void;
  onToggleActiveConnection?: (noteId: string) => void;
  onDelete?: (noteId: string) => void;
  onOpenSpecialNote?: (note: TimelineNote) => void;
  specialNotePreviewUrl?: string;
  /** The uploaded file no longer exists. */
  specialNoteFileMissing?: boolean;
  isSpecialNoteDeleting?: boolean;
}

export function TimelineNoteCard({
  note,
  connectedNodeCount,
  activeNodeId,
  isConnectedToActiveNode = false,
  readOnly = false,
  onMove,
  onMoveEnd,
  getZoom,
  onResize,
  onTextChange,
  onKindChange,
  onColorChange,
  onToggleActiveConnection,
  onDelete,
  onOpenSpecialNote,
  specialNotePreviewUrl,
  specialNoteFileMissing,
  isSpecialNoteDeleting = false,
}: TimelineNoteCardProps) {
  const specialNote = isSpecialNote(note);
  const width = note.width ?? TIMELINE_NOTE_DEFAULT_WIDTH;
  const height = note.height ?? (specialNote ? SPECIAL_NOTE_MIN_HEIGHT : TIMELINE_NOTE_MIN_HEIGHT);
  const colorStyle = noteColorStyle(note.color);
  const cardRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ pointerId: number; clientX: number; clientY: number; x: number; y: number } | null>(null);
  const resizeStartRef = useRef<{ pointerId: number; clientX: number; clientY: number; width: number; height: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [kindMenuOpen, setKindMenuOpen] = useState(false);
  // A note that was just added (still empty) opens ready to type in.
  const [isEditingText, setIsEditingText] = useState(() => !readOnly && !note.text && !!note.createdAt && Date.now() - Date.parse(note.createdAt) < 5000);
  const [isHovered, setIsHovered] = useState(false);
  // Colour, delete and resize stay out of the way until the note is hovered or being edited.
  // Keyboard focus on a control keeps the controls visible too, so a focused button is never invisible.
  const [controlFocused, setControlFocused] = useState(false);
  const showControls = isHovered || isEditingText || isDragging || isResizing || kindMenuOpen || controlFocused;
  const controlFocusHandlers = {
    onFocus: (event: React.FocusEvent<HTMLElement>) => { if (event.target.matches(":focus-visible")) setControlFocused(true); },
    onBlur: () => setControlFocused(false),
  };

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
      const zoom = getZoom?.() || 1;
      onMove?.(note.id, start.x + (event.clientX - start.clientX) / zoom, start.y + (event.clientY - start.clientY) / zoom);
    },
    [getZoom, note.id, onMove, readOnly],
  );

  const finishDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const start = dragStartRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    dragStartRef.current = null;
    setIsDragging(false);
    onMoveEnd?.();
  }, [onMoveEnd]);

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
      const zoom = getZoom?.() || 1;
      const nextWidth = Math.max(180, start.width + (event.clientX - start.clientX) / zoom);
      const minHeight = specialNote ? SPECIAL_NOTE_MIN_HEIGHT : TIMELINE_NOTE_MIN_HEIGHT;
      const nextHeight = Math.max(minHeight, start.height + (event.clientY - start.clientY) / zoom);
      onResize?.(note.id, nextWidth, nextHeight);
    },
    [getZoom, note.id, onResize, readOnly, specialNote],
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
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
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
          borderRadius: "0.25rem 0.25rem 0.25rem 0.875rem",
          background: colorStyle.background,
          boxShadow: isDragging ? "0.25rem 0.375rem 0 rgba(0,0,0,0.22)" : "none",
          transition: "box-shadow 0.12s",
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
          <span
            style={{
              fontSize: "0.625rem",
              fontFamily: "var(--font-mono), monospace",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: colorStyle.accent,
            }}
          >
            {noteKindLabel(specialNote ? "special_note" : note.kind)}
          </span>

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

        {specialNote && note.specialNote ? (
          <SpecialNotePreview
            file={note.specialNote}
            previewUrl={specialNotePreviewUrl}
            missing={specialNoteFileMissing}
            disabled={readOnly || Boolean(specialNoteFileMissing)}
            onOpen={() => onOpenSpecialNote?.(note)}
          />
        ) : !readOnly && isEditingText ? (
          <textarea
            data-note-control="true"
            value={note.text}
            onChange={(event) => onTextChange?.(note.id, event.currentTarget.value)}
            onPointerDown={(event) => event.stopPropagation()}
            onFocus={() => setIsEditingText(true)}
            onBlur={() => setIsEditingText(false)}
            placeholder="Write a note…"
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
              fontSize: "0.875rem",
              fontWeight: 400,
              lineHeight: 1.55,
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
                color: note.text ? "var(--text-primary)" : "var(--text-tertiary)",
                fontFamily: "var(--font-sans), sans-serif",
                fontSize: "0.875rem",
                fontWeight: 400,
                lineHeight: 1.55,
                letterSpacing: 0,
                overflowWrap: "break-word",
              }}
            >
              {note.text || "Write a note…"}
            </MarkdownContent>
          </button>
        )}

        {!readOnly && (
          // The same floating action bar as paper cards: kind, colour and delete, under the note.
          <div
            data-note-control="true"
            className={bar.bar}
            data-show={showControls ? "" : undefined}
            style={{ top: "calc(100% + 10px)" }}
            {...controlFocusHandlers}
            onPointerDown={(event) => event.stopPropagation()}
          >
            {!specialNote && (
              <>
                <div className={bar.groupAnchor}>
                  <button type="button" onClick={() => setKindMenuOpen((open) => !open)} aria-expanded={kindMenuOpen} title="Change note type">
                    {NOTE_KIND_OPTIONS.find((kind) => kind.key === (note.kind ?? "field_note"))?.label ?? "Field note"}
                    <svg width="9" height="9" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 3l2 2 2-2" /></svg>
                  </button>
                  {kindMenuOpen && (
                    <div className={bar.groupMenu} role="menu" style={{ width: 170 }}>
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
                          >
                            <span>{kind.label}</span>
                            {selected && <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2.5 6.5 5 9l4.5-6" /></svg>}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                <span className={bar.sep} aria-hidden="true" />
              </>
            )}
            <div className={bar.swatches}>
              {NOTE_COLOR_OPTIONS.map((color) => {
                const selected = (note.color ?? "paper") === color.key;
                return (
                  <button
                    key={color.key}
                    type="button"
                    className={bar.swatch}
                    aria-pressed={selected}
                    title={`${color.label} note`}
                    aria-label={`Make the note ${color.label.toLowerCase()}`}
                    onClick={() => onColorChange?.(note.id, color.key)}
                    style={{ background: color.accent }}
                  />
                );
              })}
            </div>
            <span className={bar.sep} aria-hidden="true" />
            <button
              type="button"
              className={bar.danger}
              onClick={() => onDelete?.(note.id)}
              disabled={isSpecialNoteDeleting}
              aria-label={specialNote ? "Delete file" : "Delete note"}
              title={isSpecialNoteDeleting ? "Deleting…" : specialNote ? "Delete file" : "Delete note"}
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.5 8.5h6l.5-8.5" /></svg>
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
              borderRadius: "0.375rem",
              background: "color-mix(in srgb, var(--text-primary) 8%, transparent)",
              color: isConnectedToActiveNode ? "var(--text-primary)" : "var(--text-secondary)",
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
            {...controlFocusHandlers}
            style={{
              position: "absolute",
              right: "0.5rem",
              bottom: "0.5rem",
              width: "1rem",
              height: "1rem",
              border: "none",
              background: "transparent",
              cursor: "nwse-resize",
              opacity: showControls ? 1 : 0,
              transition: "opacity 0.12s",
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
  missing,
  disabled,
  onOpen,
}: {
  file: SpecialNoteFile;
  previewUrl?: string;
  missing?: boolean;
  disabled: boolean;
  onOpen: () => void;
}) {
  const label = missing ? "FILE DELETED" : file.fileType === "pdf" ? "PDF" : file.fileType === "spreadsheet" ? "SHEET" : "IMAGE";
  const accent = missing ? "var(--text-tertiary)" : file.fileType === "pdf" ? "var(--cat-rose)" : file.fileType === "spreadsheet" ? "var(--cat-green)" : "var(--cat-blue)";

  return (
    <button
      data-note-control="true"
      type="button"
      disabled={disabled}
      onClick={onOpen}
      onPointerDown={(event) => event.stopPropagation()}
      title={missing ? `${file.filename} was deleted. Delete this note to remove it.` : disabled ? file.filename : `Open ${file.filename}`}
      style={{
        position: "relative",
        display: "block",
        width: "calc(100% - 1.5rem)",
        flex: 1,
        minHeight: "8.5rem",
        // Same gap below as at the sides, now that the controls live in the floating bar.
        margin: "0.625rem 0.75rem 0.75rem",
        overflow: "hidden",
        border: "0.0625rem solid var(--border)",
        borderRadius: "0.5rem",
        background: "var(--bg-tertiary)",
        color: "var(--text-primary)",
        cursor: disabled ? "default" : "pointer",
        textAlign: "left",
      }}
    >
      {missing ? (
        <div
          style={{
            display: "grid",
            height: "100%",
            placeItems: "center",
            alignContent: "center",
            gap: "0.375rem",
            padding: "1rem",
            textAlign: "center",
            color: "var(--text-tertiary)",
            fontSize: "0.75rem",
            lineHeight: 1.5,
          }}
        >
          <span style={{ color: "var(--text-secondary)", fontWeight: 550 }}>This file was deleted</span>
          <span>The note came back, but its upload did not. Delete the note to remove it.</span>
        </div>
      ) : file.fileType === "image" && previewUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- Signed Supabase Storage URLs cannot use Next image optimization.
        <img
          src={previewUrl}
          alt={`Preview of ${file.filename}`}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : (
        <div
          aria-hidden="true"
          style={{
            display: "grid",
            height: "100%",
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
