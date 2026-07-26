"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

const EXAMPLES = [
  "Transformer",
  "VLMs",
  "Feynman Path Integrals",
  "CRISPR",
];

interface SearchInputProps {
  onSearch: (query: string) => void;
  isSearching: boolean;
  traceMode: "standard" | "deep";
  onTraceModeChange: (mode: "standard" | "deep") => void;
}

export function SearchInput({ onSearch, isSearching, traceMode, onTraceModeChange }: SearchInputProps) {
  const [query, setQuery] = useState("");
  const [modeOpen, setModeOpen] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim() && !isSearching) {
      onSearch(query.trim());
    }
  };

  const modeLabel = traceMode === "deep" ? "Deep trace" : "Quick trace";

  return (
    <motion.form
      className="trace-search"
      onSubmit={handleSubmit}
      aria-label="Search the research lineage"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
      style={{
        position: "relative",
        width: "100%",
        maxWidth: "34rem",
      }}
    >
      <div
        className="trace-search-field"
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          gap: "0.625rem",
          background: "var(--bg-secondary)",
          border: "0.0625rem solid var(--border)",
          borderRadius: "0.375rem",
          padding: "0.625rem 0.625rem 0.625rem 0.875rem",
          transition: "border-color 0.12s ease, box-shadow 0.12s ease",
        }}
      >
        {/* Search icon */}
        <svg
          width="16"
          height="16"
          viewBox="0 0 18 18"
          fill="none"
          style={{ flexShrink: 0, color: "var(--text-tertiary)" }}
        >
          <path
            d="M16.5 16.5L12.875 12.875M14.8333 8.16667C14.8333 11.8486 11.8486 14.8333 8.16667 14.8333C4.48477 14.8333 1.5 11.8486 1.5 8.16667C1.5 4.48477 4.48477 1.5 8.16667 1.5C11.8486 1.5 14.8333 4.48477 14.8333 8.16667Z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>

        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search a concept, paper, DOI, or arXiv ID"
          disabled={isSearching}
          style={{
            flex: 1,
            background: "none",
            border: "none",
            outline: "none",
            color: "var(--text-primary)",
            fontSize: "0.875rem",
            fontFamily: "'Inter', sans-serif",
            letterSpacing: "-0.006em",
          }}
        />

        <div style={{ position: "relative", flexShrink: 0, width: "1.875rem", height: "1.875rem" }}>
          {/* Spinner — visible while searching */}
          <div
            style={{
              position: "absolute", inset: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              opacity: isSearching ? 1 : 0,
              transition: "opacity 0.15s",
              pointerEvents: "none",
            }}
          >
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
              style={{
                width: "1.125rem", height: "1.125rem",
                border: "0.125rem solid var(--border)",
                borderTopColor: "var(--accent)",
                borderRadius: "50%",
              }}
            />
          </div>
          {/* Submit button — visible when query is non-empty and not searching */}
          <button
            type="submit"
            aria-label={query.trim() ? `Search: ${query.trim()}` : "Search"}
            disabled={isSearching || !query.trim()}
            style={{
              position: "absolute", inset: 0,
              background: "var(--accent)",
              border: "none",
              borderRadius: "0.25rem",
              color: "var(--on-accent)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: query.trim() && !isSearching ? "pointer" : "default",
              opacity: !isSearching && query.trim() ? 1 : 0,
              transition: "opacity 0.15s",
              pointerEvents: !isSearching && query.trim() ? "auto" : "none",
            }}
          >
            <svg width="11" height="11" viewBox="0 0 10 10" fill="none" stroke="var(--on-accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 8L8 2M8 2H3.5M8 2V6.5" />
            </svg>
          </button>
        </div>
      </div>

      {/* Examples */}
      <motion.div
        className="trace-search-examples"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4, duration: 0.5 }}
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: "0.5rem",
          marginTop: "1rem",
        }}
      >
        {EXAMPLES.map((example, i) => (
          <motion.button
            key={example}
            className={`trace-search-suggestion${example === "Feynman Path Integrals" ? " hide-mobile" : ""}${example === "CRISPR" ? " show-mobile" : ""}`}
            type="button"
            disabled={isSearching}
            onClick={() => onSearch(example)}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.45 + i * 0.07, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            whileTap={{ scale: 0.97 }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.375rem",
              background: "var(--bg-secondary)",
              border: "0.0625rem solid var(--border)",
              borderRadius: "0.25rem",
              padding: "0.375rem 0.75rem",
              fontSize: "0.75rem",
              color: "var(--text-secondary)",
              fontFamily: "'Inter', sans-serif",
              fontWeight: 500,
              cursor: isSearching ? "default" : "pointer",
              transition: "border-color 0.12s, color 0.12s, background 0.12s",
              letterSpacing: "-0.006em",
            }}
            onMouseEnter={(e) => {
              if (!isSearching) {
                e.currentTarget.style.borderColor = "var(--border-hover)";
                e.currentTarget.style.color = "var(--text-primary)";
                e.currentTarget.style.background = "var(--bg-tertiary)";
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "var(--border)";
              e.currentTarget.style.color = "var(--text-secondary)";
              e.currentTarget.style.background = "var(--bg-secondary)";
            }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <path d="M2 8L8 2M8 2H3.5M8 2V6.5" />
            </svg>
            {example}
          </motion.button>
        ))}
        <div className="trace-search-mode-control" style={{ position: "relative", zIndex: 3 }}>
          <button
            type="button"
            className="trace-search-mode"
            onClick={() => setModeOpen((open) => !open)}
            aria-expanded={modeOpen}
            aria-haspopup="menu"
            disabled={isSearching}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.375rem",
              minHeight: "2.5rem",
              padding: "0.375rem 0.75rem",
              borderRadius: "0.25rem",
              border: traceMode === "deep"
                ? "0.0625rem solid var(--accent)"
                : "0.0625rem solid var(--border)",
              background: traceMode === "deep" ? "var(--accent-soft)" : "var(--bg-secondary)",
              color: traceMode === "deep" ? "var(--accent)" : "var(--text-secondary)",
              fontFamily: "'Inter', sans-serif",
              fontSize: "0.75rem",
              fontWeight: 500,
              cursor: isSearching ? "default" : "pointer",
              opacity: isSearching ? 0.65 : 1,
              transition: "border-color 0.12s, color 0.12s, background 0.12s",
            }}
            onMouseEnter={(e) => {
              if (!isSearching && traceMode !== "deep") {
                e.currentTarget.style.borderColor = "var(--border-hover)";
                e.currentTarget.style.color = "var(--text-primary)";
                e.currentTarget.style.background = "var(--bg-tertiary)";
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = traceMode === "deep"
                ? "var(--accent)"
                : "var(--border)";
              e.currentTarget.style.color = traceMode === "deep" ? "var(--accent)" : "var(--text-secondary)";
              e.currentTarget.style.background = traceMode === "deep" ? "var(--accent-soft)" : "var(--bg-secondary)";
            }}
          >
            {traceMode === "deep" ? (
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ flexShrink: 0, color: "var(--accent)" }}>
                <path d="M9.25 1.5 3.5 8h4.1L6.75 14.5l5.75-7H8.4z" fill="currentColor" />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 18 18" fill="none" aria-hidden="true" style={{ flexShrink: 0, color: "var(--accent)" }}>
                <path d="M16.5 16.5L12.875 12.875M14.8333 8.16667C14.8333 11.8486 11.8486 14.8333 8.16667 14.8333C4.48477 14.8333 1.5 11.8486 1.5 8.16667C1.5 4.48477 4.48477 1.5 8.16667 1.5C11.8486 1.5 14.8333 4.48477 14.8333 8.16667Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
            <span>{modeLabel}</span>
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true" style={{ transform: modeOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>
              <path d="m2.5 4.5 3.5 3 3.5-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          <AnimatePresence>
            {modeOpen && (
              <motion.div
                className="trace-search-mode-menu"
                initial={{ opacity: 0, y: -5, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -5, scale: 0.98 }}
                transition={{ duration: 0.14 }}
                role="menu"
                style={{
                  position: "absolute",
                  top: "calc(100% + 0.45rem)",
                  right: 0,
                  width: "min(20rem, calc(100vw - 2rem))",
                  padding: "0.375rem",
                  borderRadius: "0.375rem",
                  border: "0.0625rem solid var(--border)",
                  background: "color-mix(in srgb, var(--bg-primary) 98%, transparent)",
                  backdropFilter: "blur(12px)",
                  boxShadow: "0 0.5rem 1.5rem rgba(0,0,0,0.10)",
                }}
              >
                {([
                  ["standard", "Quick trace", "Fast, focused lineage from the best matching seed."],
                  ["deep", "Deep trace", "Agentic research, reference checks, and colored guide notes."],
                ] as const).map(([mode, label, description]) => {
                  const selected = traceMode === mode;
                  return (
                    <button
                      key={mode}
                      type="button"
                      role="menuitemradio"
                      aria-checked={selected}
                      onClick={() => {
                        onTraceModeChange(mode);
                        setModeOpen(false);
                      }}
                      style={{
                        width: "100%",
                        display: "grid",
                        gridTemplateColumns: "1.25rem 1fr",
                        gap: "0.625rem",
                        alignItems: "start",
                        padding: "0.75rem",
                        border: "none",
                        borderRadius: "0.25rem",
                        background: selected ? "var(--accent-soft)" : "transparent",
                        color: "var(--text-primary)",
                        textAlign: "left",
                        cursor: "pointer",
                        fontFamily: "'Inter', sans-serif",
                      }}
                    >
                      <span style={{ color: selected ? "var(--accent)" : "var(--text-tertiary)", display: "flex", alignItems: "center", justifyContent: "center", marginTop: "0.1rem" }}>
                        {mode === "deep" ? (
                          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                            <path d="M9.25 1.5 3.5 8h4.1L6.75 14.5l5.75-7H8.4z" fill="currentColor" />
                          </svg>
                        ) : (
                          <svg width="14" height="14" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                            <path d="M16.5 16.5L12.875 12.875M14.8333 8.16667C14.8333 11.8486 11.8486 14.8333 8.16667 14.8333C4.48477 14.8333 1.5 11.8486 1.5 8.16667C1.5 4.48477 4.48477 1.5 8.16667 1.5C11.8486 1.5 14.8333 4.48477 14.8333 8.16667Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </span>
                      <span>
                        <span style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.9rem", fontWeight: 600 }}>
                          {label}
                          {mode === "deep" && <span style={{ padding: "0.1rem 0.35rem", borderRadius: "0.125rem", background: "var(--accent-soft)", color: "var(--accent)", fontSize: "0.625rem", fontFamily: "'Geist Mono', monospace", letterSpacing: "0.04em" }}>NEW</span>}
                        </span>
                        <span style={{ display: "block", marginTop: "0.2rem", color: "var(--text-tertiary)", fontSize: "0.73rem", lineHeight: 1.35 }}>{description}</span>
                      </span>
                    </button>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </motion.form>
  );
}
