"use client";

import { useState, useRef, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";

const EXAMPLES = [
  "Transformer",
  "VLMs",
  "Feynman Path Integrals",
];

interface SearchInputProps {
  onSearch: (query: string) => void;
  isSearching: boolean;
  traceMode: "standard" | "deep";
  onTraceModeChange: (mode: "standard" | "deep") => void;
}

export function SearchInput({ onSearch, isSearching, traceMode, onTraceModeChange }: SearchInputProps) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [modeOpen, setModeOpen] = useState(false);
  const borderRef = useRef<HTMLDivElement>(null);
  const [boxSize, setBoxSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    if (!borderRef.current) return;
    const update = () => {
      if (!borderRef.current) return;
      const { width, height } = borderRef.current.getBoundingClientRect();
      setBoxSize({ w: Math.round(width), h: Math.round(height) });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(borderRef.current);
    return () => ro.disconnect();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim() && !isSearching) {
      onSearch(query.trim());
    }
  };

  const { w, h } = boxSize;
  const r = 14; // matches CSS border-radius; SVG now covers the full border-box
  const mx = w / 2;
  const my = h / 2;
  const modeLabel = traceMode === "deep" ? "Deep trace" : "Quick trace";

  // 4 paths, each starting from center of a horizontal edge, sweeping outward and meeting at vertical midpoints:
  // Top-right: center-top → top-right corner → mid-right
  const trPath = w > 0 ? `M ${mx},0 L ${w - r},0 A ${r},${r} 0 0,1 ${w},${r} L ${w},${my}` : "";
  // Bottom-right: center-bottom → bottom-right corner → mid-right
  const brPath = w > 0 ? `M ${mx},${h} L ${w - r},${h} A ${r},${r} 0 0,0 ${w},${h - r} L ${w},${my}` : "";
  // Top-left: center-top → top-left corner → mid-left
  const tlPath = w > 0 ? `M ${mx},0 L ${r},0 A ${r},${r} 0 0,0 0,${r} L 0,${my}` : "";
  // Bottom-left: center-bottom → bottom-left corner → mid-left
  const blPath = w > 0 ? `M ${mx},${h} L ${r},${h} A ${r},${r} 0 0,1 0,${h - r} L 0,${my}` : "";

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
        maxWidth: "39rem",
      }}
    >
      <div
        ref={borderRef}
        className="trace-search-field"
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          background: "var(--bg-secondary)",
          border: "0.0625rem solid var(--border)",
          borderRadius: "0.75rem",
          padding: "0.75rem 0.875rem 0.75rem 1rem",
          boxShadow: focused
            ? "0 0.125rem 1rem rgba(0,0,0,0.08)"
            : "0 0.125rem 0.75rem rgba(0,0,0,0.04)",
          transition: "box-shadow 0.25s",
        }}
      >
        {/* Animated accent border — draws from center-top outward on focus */}
        {w > 0 && (
          <svg
            style={{
              position: "absolute",
              inset: "-0.0625rem",
              width: "calc(100% + 0.125rem)",
              height: "calc(100% + 0.125rem)",
              pointerEvents: "none",
              overflow: "visible",
            }}
            viewBox={`0 0 ${w} ${h}`}
          >
            {[trPath, brPath, tlPath, blPath].map((d, i) => (
              <motion.path
                key={i}
                d={d}
                fill="none"
                stroke="var(--accent)"
                strokeLinecap="butt"
                initial={{ pathLength: 0, opacity: 0, strokeWidth: 0 }}
                animate={{
                  pathLength: focused ? 1 : 0,
                  opacity: focused ? 0.55 : 0,
                  strokeWidth: focused ? 1 : 0,
                }}
                transition={{
                  pathLength: { duration: focused ? 1.0 : 0.3, ease: focused ? "linear" : "easeIn" },
                  opacity: { duration: 0.2 },
                  strokeWidth: { duration: focused ? 0.3 : 0.15 },
                }}
              />
            ))}
          </svg>
        )}

        {/* Search icon */}
        <svg
          width="18"
          height="18"
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
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="Search a concept, paper, DOI, or arXiv ID"
          disabled={isSearching}
          style={{
            flex: 1,
            background: "none",
            border: "none",
            outline: "none",
            color: "var(--text-primary)",
            fontSize: "0.9375rem",
            fontFamily: "'DM Sans', sans-serif",
            letterSpacing: "-0.01em",
          }}
        />

        <div style={{ position: "relative", flexShrink: 0, width: "2.125rem", height: "2.125rem" }}>
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
              borderRadius: "0.5rem",
              color: "white",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: query.trim() && !isSearching ? "pointer" : "default",
              opacity: !isSearching && query.trim() ? 1 : 0,
              transition: "opacity 0.15s",
              pointerEvents: !isSearching && query.trim() ? "auto" : "none",
            }}
          >
            <svg width="11" height="11" viewBox="0 0 10 10" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
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
            className={`trace-search-suggestion${example === "Feynman Path Integrals" ? " hide-mobile" : ""}`}
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
              borderRadius: "0.5rem",
              padding: "0.375rem 0.75rem",
              fontSize: "0.75rem",
              color: "var(--text-secondary)",
              fontFamily: "'DM Sans', sans-serif",
              fontWeight: 500,
              cursor: isSearching ? "default" : "pointer",
              transition: "border-color 0.15s, color 0.15s, background 0.15s",
              letterSpacing: "-0.01em",
            }}
            onMouseEnter={(e) => {
              if (!isSearching) {
                e.currentTarget.style.borderColor = "var(--accent)";
                e.currentTarget.style.color = "var(--text-primary)";
                e.currentTarget.style.background = "var(--accent-soft)";
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "var(--border)";
              e.currentTarget.style.color = "var(--text-secondary)";
              e.currentTarget.style.background = "var(--bg-secondary)";
            }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <path d="M2 8L8 2M8 2H3.5M8 2V6.5" />
            </svg>
            {example}
          </motion.button>
        ))}
        <div style={{ position: "relative", zIndex: 3 }}>
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
              borderRadius: "0.5rem",
              border: traceMode === "deep"
                ? "0.0625rem solid color-mix(in srgb, var(--accent) 58%, var(--border))"
                : "0.0625rem solid var(--border)",
              background: "var(--bg-secondary)",
              color: "var(--text-secondary)",
              fontFamily: "'DM Sans', sans-serif",
              fontSize: "0.75rem",
              fontWeight: 500,
              cursor: isSearching ? "default" : "pointer",
              opacity: isSearching ? 0.65 : 1,
              transition: "border-color 0.15s, color 0.15s, background 0.15s",
            }}
            onMouseEnter={(e) => {
              if (!isSearching) {
                e.currentTarget.style.borderColor = "var(--accent)";
                e.currentTarget.style.color = "var(--text-primary)";
                e.currentTarget.style.background = "var(--accent-soft)";
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = traceMode === "deep"
                ? "color-mix(in srgb, var(--accent) 58%, var(--border))"
                : "var(--border)";
              e.currentTarget.style.color = "var(--text-secondary)";
              e.currentTarget.style.background = "var(--bg-secondary)";
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
                  borderRadius: "1rem",
                  border: "0.0625rem solid var(--border-hover)",
                  background: "color-mix(in srgb, var(--bg-secondary) 96%, #17100b 4%)",
                  boxShadow: "0 1rem 2.5rem rgba(0,0,0,0.28)",
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
                        borderRadius: "0.75rem",
                        background: selected ? "color-mix(in srgb, var(--accent) 12%, transparent)" : "transparent",
                        color: "var(--text-primary)",
                        textAlign: "left",
                        cursor: "pointer",
                        fontFamily: "'DM Sans', sans-serif",
                      }}
                    >
                      <span style={{ color: selected ? "var(--accent)" : "var(--text-tertiary)", fontSize: "1.1rem", lineHeight: 1 }}>{mode === "deep" ? "⌁" : "⌕"}</span>
                      <span>
                        <span style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.9rem", fontWeight: 600 }}>
                          {label}
                          {mode === "deep" && <span style={{ padding: "0.1rem 0.35rem", borderRadius: "0.4rem", background: "color-mix(in srgb, var(--accent) 18%, transparent)", color: "var(--accent)", fontSize: "0.625rem", fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.04em" }}>NEW</span>}
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
