"use client";

import { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";

const EXAMPLES = [
  "Transformer",
  "CRISPR",
  "Diffusion Models",
];

interface SearchInputProps {
  onSearch: (query: string) => void;
  isSearching: boolean;
}

export function SearchInput({ onSearch, isSearching }: SearchInputProps) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
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
      onSubmit={handleSubmit}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
      style={{
        position: "relative",
        width: "100%",
        maxWidth: "32.5rem",
      }}
    >
      <div
        ref={borderRef}
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          background: "var(--bg-secondary)",
          border: "0.0625rem solid var(--border)",
          borderRadius: "0.875rem",
          padding: "0.875rem 1.125rem",
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
          placeholder="Trace a concept..."
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
      </motion.div>
    </motion.form>
  );
}
