"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { m } from "framer-motion";

interface Props {
  question: string;
  options: (string | { value: string; label: string; description?: string })[];
  allowCustomQuery?: boolean;
  returnFocusRef?: RefObject<HTMLElement | null>;
  onSelect: (query: string) => void;
  onDismiss: () => void;
}

export function ClarificationModal({ question, options, onSelect, onDismiss, allowCustomQuery = true, returnFocusRef }: Props) {
  const [customValue, setCustomValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const firstOptionRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusableElements = () => Array.from(dialog.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])',
    )).filter((element) => element.tabIndex >= 0 && element.getClientRects().length > 0);
    const containTab = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const elements = focusableElements();
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (!first || !last) {
        event.preventDefault();
        dialog.focus();
      } else if (!dialog.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    (inputRef.current ?? firstOptionRef.current ?? dialog).focus({ preventScroll: true });
    document.addEventListener("keydown", containTab);
    return () => {
      document.removeEventListener("keydown", containTab);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus({ preventScroll: true });
      }
      // The search input can lose focus when disabled during the request.
      if (document.activeElement === document.body || dialog.contains(document.activeElement)) {
        const trigger = returnFocusRef?.current;
        (trigger?.querySelector<HTMLElement>("input, button") ?? trigger)?.focus({ preventScroll: true });
      }
    };
  }, [returnFocusRef]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onDismiss();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onDismiss]);

  function handleCustomSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = customValue.trim();
    if (trimmed) onSelect(trimmed);
  }

  return (
    <m.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onDismiss}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(10, 8, 5, 0.55)",
        zIndex: 200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1.5rem",
      }}
    >
      <m.div
        initial={{ opacity: 0, y: 16, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16, scale: 0.97 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        role="dialog"
        ref={dialogRef}
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby="clarify-question"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: "30rem",
          maxHeight: "calc(100dvh - 3rem)",
          overflowY: "auto",
          background: "var(--bg-primary)",
          border: "0.0625rem solid var(--border)",
          borderRadius: "0.5rem",
          boxShadow: "0 1rem 2.5rem rgba(0,0,0,0.16)",
          padding: "1.5rem",
          display: "flex",
          flexDirection: "column",
          gap: "1rem",
        }}
      >
          {/* Header */}
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.75rem" }}>
            <div>
              <p
                style={{
                  fontSize: "0.625rem",
                  color: "var(--accent)",
                  fontFamily: "var(--font-mono), monospace",
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  marginBottom: "0.5rem",
                }}
              >
                help me find the right trace
              </p>
              <p
                id="clarify-question"
                style={{
                  fontSize: "1rem",
                  color: "var(--text-primary)",
                  fontFamily: "var(--font-sans), sans-serif",
                  fontWeight: 500,
                  lineHeight: 1.4,
                }}
              >
                {question}
              </p>
            </div>
            <button
              onClick={onDismiss}
              aria-label="Dismiss"
              style={{
                flexShrink: 0,
                width: "1.75rem",
                height: "1.75rem",
                borderRadius: "0.4375rem",
                border: "0.0625rem solid var(--border)",
                background: "none",
                color: "var(--text-tertiary)",
                cursor: "pointer",
                fontSize: "1rem",
                lineHeight: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              ×
            </button>
          </div>

          {/* Option chips */}
          {options.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {options.map((option, index) => {
                const value = typeof option === "string" ? option : option.value;
                const label = typeof option === "string" ? option : option.label;
                const description = typeof option === "string" ? undefined : option.description;
                return (
                <button
                  key={value}
                  ref={index === 0 ? firstOptionRef : undefined}
                  onClick={() => onSelect(value)}
                  style={{
                    textAlign: "left",
                    padding: "0.6875rem 0.875rem",
                    borderRadius: "0.25rem",
                    border: "0.0625rem solid var(--border)",
                    background: "var(--bg-secondary)",
                    color: "var(--text-primary)",
                    fontSize: "0.875rem",
                    fontFamily: "var(--font-sans), sans-serif",
                    fontWeight: 500,
                    cursor: "pointer",
                    transition: "border-color 0.12s, background 0.12s, color 0.12s",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.625rem",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "var(--accent)";
                    e.currentTarget.style.background = "var(--accent-soft)";
                    e.currentTarget.style.color = "var(--accent)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "var(--border)";
                    e.currentTarget.style.background = "var(--bg-primary)";
                    e.currentTarget.style.color = "var(--text-primary)";
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, opacity: 0.5 }}>
                    <path d="M1 6h10M7 2l4 4-4 4" />
                  </svg>
                  <span>
                    {label}
                    {description && <span style={{ display: "block", marginTop: "0.25rem", color: "var(--text-tertiary)", fontSize: "0.75rem", fontWeight: 400 }}>{description}</span>}
                  </span>
                </button>
              );
              })}
            </div>
          )}

          {allowCustomQuery && <>
          {/* Divider */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
            <div style={{ flex: 1, height: "0.0625rem", background: "var(--border)" }} />
            <span style={{ fontSize: "0.6875rem", color: "var(--text-tertiary)", fontFamily: "var(--font-mono), monospace", letterSpacing: "0.04em" }}>
              or type your own
            </span>
            <div style={{ flex: 1, height: "0.0625rem", background: "var(--border)" }} />
          </div>

          {/* Custom input */}
          <form onSubmit={handleCustomSubmit} style={{ display: "flex", gap: "0.5rem" }}>
            <input
              ref={inputRef}
              value={customValue}
              onChange={(e) => setCustomValue(e.target.value)}
              placeholder="e.g. attention mechanism in transformers"
              style={{
                flex: 1,
                height: "2.25rem",
                padding: "0 0.75rem",
                borderRadius: "0.5rem",
                border: "0.0625rem solid var(--border)",
                background: "var(--bg-primary)",
                color: "var(--text-primary)",
                fontSize: "0.875rem",
                fontFamily: "var(--font-sans), sans-serif",
                outline: "none",
                transition: "border-color 0.12s",
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = "var(--border)"; }}
            />
            <button
              type="submit"
              disabled={!customValue.trim()}
              style={{
                height: "2.25rem",
                padding: "0 1rem",
                borderRadius: "0.5rem",
                border: "0.0625rem solid var(--accent)",
                background: "var(--accent-soft)",
                color: "var(--accent)",
                fontSize: "0.8125rem",
                fontFamily: "var(--font-sans), sans-serif",
                fontWeight: 600,
                cursor: customValue.trim() ? "pointer" : "default",
                opacity: customValue.trim() ? 1 : 0.45,
                transition: "opacity 0.12s",
              }}
            >
              Trace
            </button>
          </form>
          </>}
      </m.div>
    </m.div>
  );
}
