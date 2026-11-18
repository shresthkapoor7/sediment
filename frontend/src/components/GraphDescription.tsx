"use client";

import { useEffect, useRef, useState } from "react";

export const MAX_GRAPH_DESCRIPTION_LENGTH = 500;

interface GraphDescriptionProps {
  description: string;
  /** Omitted when the viewer cannot edit this canvas. */
  onSave?: (description: string) => void;
}

/** A note icon beside the canvas title; it opens the canvas description, editable for the owner. */
export function GraphDescription({ description, onSave }: GraphDescriptionProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(description);
  // Only a draft the researcher typed into is saved; an untouched one must not overwrite a newer agent update.
  const [edited, setEdited] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const has = description.trim().length > 0;

  useEffect(() => {
    if (!open) return;
    function close() {
      setOpen(false);
      if (onSave && edited && draft.trim() !== description.trim()) onSave(draft.trim());
    }
    function onPointerDown(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) close();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") { setDraft(description); setOpen(false); }
    }
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, draft, description, edited, onSave]);

  if (!onSave && !has) return null;

  return (
    <div ref={root} className="graph-description">
      <button
        type="button"
        className="graph-description-trigger"
        data-filled={has ? "" : undefined}
        aria-expanded={open}
        title={has ? description : "Add a description"}
        aria-label={has ? "Canvas description" : "Add a description"}
        onClick={() => {
          if (open) {
            // Closing with the icon keeps the edit, like clicking away does; Escape is the way to discard it.
            if (onSave && edited && draft.trim() !== description.trim()) onSave(draft.trim());
            setOpen(false);
            return;
          }
          setDraft(description);
          setEdited(false);
          setOpen(true);
          window.requestAnimationFrame(() => field.current?.focus());
        }}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
          <path d="M3 4h10M3 8h10M3 12h6" />
        </svg>
      </button>
      {open && (
        <div className="graph-description-popover" role="dialog" aria-label="Canvas description">
          {onSave ? (
            <>
              <textarea
                ref={field}
                value={draft}
                maxLength={MAX_GRAPH_DESCRIPTION_LENGTH}
                rows={4}
                placeholder="What is this canvas for?"
                onChange={(event) => { setDraft(event.target.value); setEdited(true); }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    if (edited) onSave(draft.trim());
                    setOpen(false);
                  }
                }}
              />
              <div className="graph-description-hint">
                <span>{draft.length}/{MAX_GRAPH_DESCRIPTION_LENGTH}</span>
                <span>⌘↵ to save</span>
              </div>
            </>
          ) : (
            <p className="graph-description-text">{description}</p>
          )}
        </div>
      )}
    </div>
  );
}
