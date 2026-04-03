"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface SearchInputProps {
  onSearch: (query: string) => void;
  isSearching: boolean;
}

export function SearchInput({ onSearch, isSearching }: SearchInputProps) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim() && !isSearching) {
      onSearch(query.trim());
    }
  };

  return (
    <motion.form
      onSubmit={handleSubmit}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
      style={{
        position: "relative",
        width: "100%",
        maxWidth: 520,
      }}
    >
      <motion.div
        animate={{
          borderColor: focused ? "var(--accent)" : "var(--border)",
          boxShadow: focused
            ? "0 0 0 3px var(--accent-soft), 0 2px 12px rgba(0,0,0,0.06)"
            : "0 2px 12px rgba(0,0,0,0.04)",
        }}
        transition={{ duration: 0.25 }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          background: "var(--bg-secondary)",
          border: "1px solid var(--border)",
          borderRadius: 14,
          padding: "14px 18px",
        }}
      >
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
          placeholder="Trace a concept... (e.g. Large Language Models)"
          disabled={isSearching}
          style={{
            flex: 1,
            background: "none",
            border: "none",
            outline: "none",
            color: "var(--text-primary)",
            fontSize: 15,
            fontFamily: "'DM Sans', sans-serif",
            letterSpacing: "-0.01em",
          }}
        />

        <div style={{ position: "relative", flexShrink: 0, width: 68, height: 34 }}>
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
                width: 18, height: 18,
                border: "2px solid var(--border)",
                borderTopColor: "var(--accent)",
                borderRadius: "50%",
              }}
            />
          </div>
          {/* Submit button — visible when query is non-empty and not searching */}
          <button
            type="submit"
            disabled={isSearching || !query.trim()}
            style={{
              position: "absolute", inset: 0,
              background: "var(--accent)",
              border: "none",
              borderRadius: 8,
              color: "white",
              fontSize: 13,
              fontWeight: 500,
              cursor: query.trim() && !isSearching ? "pointer" : "default",
              fontFamily: "'DM Sans', sans-serif",
              letterSpacing: "-0.01em",
              opacity: !isSearching && query.trim() ? 1 : 0,
              transition: "opacity 0.15s",
              pointerEvents: !isSearching && query.trim() ? "auto" : "none",
            }}
          >
            Trace
          </button>
        </div>
      </motion.div>

      {/* Hint */}
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4, duration: 0.5 }}
        style={{
          textAlign: "center",
          marginTop: 12,
          fontSize: 11,
          color: "var(--text-tertiary)",
          fontFamily: "'JetBrains Mono', monospace",
          letterSpacing: "0.03em",
        }}
      >
        enter a concept, paper, or arXiv ID
      </motion.p>
    </motion.form>
  );
}
