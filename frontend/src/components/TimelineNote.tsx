"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { TimelineNote } from "@/lib/types";
import { NOTE_COLOR_OPTIONS, NOTE_KIND_OPTIONS, TIMELINE_NOTE_DEFAULT_WIDTH, TIMELINE_NOTE_MIN_HEIGHT, noteColorStyle, noteKindLabel } from "@/lib/note-style";
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
}: TimelineNoteCardProps) {
  const width = note.width ?? TIMELINE_NOTE_DEFAULT_WIDTH;
  const height = note.height ?? TIMELINE_NOTE_MIN_HEIGHT;
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
    <motion.div
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
          borderRadius: "0.95rem",
          border: `0.0625rem solid ${colorStyle.border}`,
          background: colorStyle.background,
          boxShadow: isDragging
            ? "0 1.125rem 2.5rem rgba(0,0,0,0.24), 0 0 0 0.1875rem var(--accent-soft)"
            : "0 0.75rem 2rem rgba(0,0,0,0.18), inset 0 0.0625rem 0 rgba(255,255,255,0.05)",
          overflow: "visible",
          userSelect: isDragging ? "none" : "auto",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(circle at 16% 10%, rgba(255,255,255,0.08), transparent 34%), linear-gradient(135deg, rgba(255,255,255,0.035), transparent 42%)",
            pointerEvents: "none",
          }}
        />

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
          {readOnly ? (
            <span
              style={{
                fontSize: "0.5625rem",
                fontFamily: "'JetBrains Mono', monospace",
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: colorStyle.accent,
              }}
            >
              {noteKindLabel(note.kind)}
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
                  fontSize: "0.5625rem",
                  fontFamily: "'JetBrains Mono', monospace",
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
                    borderRadius: "0.75rem",
                    border: "0.0625rem solid var(--border-hover)",
                    background: "color-mix(in srgb, var(--bg-primary) 92%, #1e1510 8%)",
                    boxShadow: "0 1rem 2.25rem rgba(0,0,0,0.32)",
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
                          fontFamily: "'JetBrains Mono', monospace",
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
              fontSize: "0.5625rem",
              fontFamily: "'JetBrains Mono', monospace",
              color: "var(--text-tertiary)",
              whiteSpace: "nowrap",
            }}
          >
            {connectedNodeCount} link{connectedNodeCount === 1 ? "" : "s"}
          </span>
        </div>

        {!readOnly && isEditingText ? (
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
              fontFamily: "'Instrument Serif', Georgia, serif",
              fontSize: "1.0625rem",
              lineHeight: 1.32,
              letterSpacing: "-0.01em",
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
                fontFamily: "'Instrument Serif', Georgia, serif",
                fontSize: "1.0625rem",
                lineHeight: 1.32,
                letterSpacing: "-0.01em",
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
              style={{
                background: "transparent",
                border: "none",
                color: "var(--text-tertiary)",
                cursor: "pointer",
                fontSize: "0.625rem",
                fontFamily: "'JetBrains Mono', monospace",
                letterSpacing: "0.04em",
                padding: "0.125rem",
              }}
            >
              Delete
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
              borderRadius: "0.5rem",
              background: isConnectedToActiveNode ? "color-mix(in srgb, var(--accent-soft) 72%, transparent)" : "var(--bg-primary)",
              color: isConnectedToActiveNode ? "var(--accent)" : "var(--text-secondary)",
              cursor: "pointer",
              fontSize: "0.625rem",
              fontFamily: "'JetBrains Mono', monospace",
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
    </motion.div>
  );
}
