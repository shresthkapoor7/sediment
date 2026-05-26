"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";

interface Props {
  question: string;
  options: string[];
  onSelect: (query: string) => void;
  onDismiss: () => void;
}

export function ClarificationModal({ question, options, onSelect, onDismiss }: Props) {
  const [customValue, setCustomValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

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
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onDismiss}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(10, 8, 5, 0.55)",
        backdropFilter: "blur(0.25rem)",
        zIndex: 200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1.5rem",
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16, scale: 0.97 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="clarify-question"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: "30rem",
          background: "var(--bg-secondary)",
          border: "0.0625rem solid var(--border-hover)",
          borderRadius: "1.25rem",
          boxShadow: "0 1.5rem 4rem rgba(0,0,0,0.28), 0 0.5rem 1rem rgba(0,0,0,0.12)",
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
                  fontFamily: "'JetBrains Mono', monospace",
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
                  fontFamily: "'DM Sans', sans-serif",
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
              {options.map((option) => (
                <button
                  key={option}
                  onClick={() => onSelect(option)}
                  style={{
                    textAlign: "left",
                    padding: "0.6875rem 0.875rem",
                    borderRadius: "0.75rem",
                    border: "0.0625rem solid var(--border)",
                    background: "var(--bg-primary)",
                    color: "var(--text-primary)",
                    fontSize: "0.875rem",
                    fontFamily: "'DM Sans', sans-serif",
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
                  {option}
                </button>
              ))}
            </div>
          )}

          {/* Divider */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
            <div style={{ flex: 1, height: "0.0625rem", background: "var(--border)" }} />
            <span style={{ fontSize: "0.6875rem", color: "var(--text-tertiary)", fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.04em" }}>
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
              autoFocus
              style={{
                flex: 1,
                height: "2.25rem",
                padding: "0 0.75rem",
                borderRadius: "0.5rem",
                border: "0.0625rem solid var(--border)",
                background: "var(--bg-primary)",
                color: "var(--text-primary)",
                fontSize: "0.875rem",
                fontFamily: "'DM Sans', sans-serif",
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
                fontFamily: "'DM Sans', sans-serif",
                fontWeight: 600,
                cursor: customValue.trim() ? "pointer" : "default",
                opacity: customValue.trim() ? 1 : 0.45,
                transition: "opacity 0.12s",
              }}
            >
              Trace
            </button>
          </form>
      </motion.div>
    </motion.div>
  );
}
