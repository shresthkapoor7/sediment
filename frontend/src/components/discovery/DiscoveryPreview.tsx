"use client";

import { m } from "framer-motion";

export interface DiscoveryPreviewData {
  kind: "paper" | "topic";
  pill: string; // "ARTICLE PREVIEW" / "SUB-FIELD"
  title: string;
  metaLine: string[]; // e.g. ["2019", "paper"]
  authors?: string[];
  summary?: string;
  href?: string;
  openLabel: string; // "Open article"
  url?: string;
  bottomLabel: string; // "TOPICS" / "PAPERS"
  bottomItems: string[];
  accent: string; // topic colour for a sub-field, --accent for a paper
}

interface DiscoveryPreviewProps {
  data: DiscoveryPreviewData;
  left: number;
  top: number;
  width: number;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

/** Mirrors the main canvas hover preview: gradient left panel + AI readout right,
 *  with a topics marquee spanning the bottom. Hoverable so the cursor can reach it. */
export function DiscoveryPreview({ data, left, top, width, onMouseEnter, onMouseLeave }: DiscoveryPreviewProps) {
  return (
    <m.div
      key={data.title}
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 10, scale: 0.98 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        position: "fixed",
        top,
        left,
        width,
        maxWidth: "calc(100vw - 2rem)",
        minHeight: "14rem",
        zIndex: 40,
        pointerEvents: "auto",
        display: "grid",
        gridTemplateColumns: "minmax(0, 13rem) minmax(0, 1fr)",
        gap: "0.875rem",
        padding: "0.875rem",
        borderRadius: "0.5rem",
        border: "0.0625rem solid color-mix(in srgb, var(--border) 65%, transparent)",
        background: "color-mix(in srgb, var(--bg-primary) 98%, transparent)",
        boxShadow: "0 1.25rem 3.5rem rgba(28, 25, 23, 0.16), 0 0.125rem 0.375rem rgba(28, 25, 23, 0.08)",
        overflow: "hidden",
      }}
    >
      {/* Left gradient column */}
      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          gap: "1rem",
          padding: "1rem",
          borderRadius: "0.375rem",
          background:
            "linear-gradient(160deg, color-mix(in srgb, var(--accent-soft) 72%, white 28%) 0%, color-mix(in srgb, var(--bg-secondary) 88%, transparent) 100%)",
          border: "0.0625rem solid color-mix(in srgb, var(--accent) 14%, var(--border) 86%)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "radial-gradient(circle at top left, color-mix(in srgb, var(--accent) 14%, transparent) 0%, transparent 55%)",
            pointerEvents: "none",
          }}
        />
        <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <span
            style={{
              alignSelf: "flex-start",
              fontSize: "0.625rem",
              fontFamily: "var(--font-mono), monospace",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: data.accent,
              background: "color-mix(in srgb, var(--bg-primary) 72%, rgba(255,255,255,0.18) 28%)",
              border: "0.0625rem solid color-mix(in srgb, var(--text-primary) 26%, transparent)",
              borderRadius: "999px",
              padding: "0.2rem 0.55rem",
              boxShadow: "inset 0 0.0625rem 0 rgba(255,255,255,0.08)",
            }}
          >
            {data.pill}
          </span>

          <div style={{ display: "flex", flexDirection: "column", gap: "0.45rem" }}>
            <p style={{ fontSize: "1rem", lineHeight: 1.25, fontWeight: 600, color: "var(--text-primary)", fontFamily: "var(--font-sans), sans-serif" }}>
              {data.title}
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.45rem", fontSize: "0.6875rem", fontFamily: "var(--font-mono), monospace", color: "var(--text-secondary)" }}>
              {data.metaLine.map((m) => (
                <span key={m}>{m}</span>
              ))}
            </div>
          </div>

          {data.authors && data.authors.length > 0 && (
            <p style={{ fontSize: "0.75rem", lineHeight: 1.5, color: "var(--text-secondary)", fontFamily: "var(--font-sans), sans-serif" }}>
              {data.authors.slice(0, 4).join(", ")}
              {data.authors.length > 4 ? " +" : ""}
            </p>
          )}
        </div>

        <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: "0.625rem" }}>
          {data.href && (
            <a
              href={data.href}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "0.5rem",
                textDecoration: "none",
                fontSize: "0.75rem",
                fontWeight: 600,
                color: "var(--text-primary)",
                fontFamily: "var(--font-sans), sans-serif",
                background: "var(--bg-secondary)",
                border: "0.0625rem solid var(--border)",
                borderRadius: "0.8rem",
                padding: "0.65rem 0.8rem",
                boxShadow: "0 0.125rem 0.375rem rgba(0,0,0,0.10)",
                transition: "transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease, color 0.18s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "translateY(-1px)";
                e.currentTarget.style.boxShadow = "0 0.25rem 0.75rem rgba(0,0,0,0.16)";
                e.currentTarget.style.borderColor = "var(--accent)";
                e.currentTarget.style.color = "var(--accent)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "translateY(0)";
                e.currentTarget.style.boxShadow = "0 0.125rem 0.375rem rgba(0,0,0,0.10)";
                e.currentTarget.style.borderColor = "var(--border)";
                e.currentTarget.style.color = "var(--text-primary)";
              }}
            >
              <span>{data.openLabel}</span>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <path d="M2 8L8 2M8 2H3.5M8 2V6.5" />
              </svg>
            </a>
          )}
          <div style={{ fontSize: "0.625rem", lineHeight: 1.55, color: "color-mix(in srgb, var(--text-secondary) 88%, transparent)", fontFamily: "var(--font-mono), monospace", wordBreak: "break-word" }}>
            {data.url ?? "No public link available"}
          </div>
        </div>
      </div>

      {/* Right readout column */}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.9rem", minWidth: 0, padding: "1rem 1rem 1rem 0.25rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <div style={{ width: "0.5rem", height: "0.5rem", borderRadius: "999px", background: data.accent, boxShadow: "0 0 1rem var(--accent-glow)", flexShrink: 0 }} />
          <p style={{ fontSize: "0.6875rem", color: "var(--text-tertiary)", fontFamily: "var(--font-mono), monospace", letterSpacing: "0.08em", textTransform: "uppercase" }}>
            In-Air Readout
          </p>
        </div>

        <div>
          <p style={{ fontSize: "0.625rem", color: "var(--text-tertiary)", fontFamily: "var(--font-mono), monospace", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: "0.4rem" }}>
            AI Summary
          </p>
          <div style={{ fontSize: "0.875rem", color: "var(--text-primary)", lineHeight: 1.65, fontFamily: "var(--font-sans), sans-serif", fontStyle: "italic", overflowWrap: "break-word" }}>
            {data.summary || "Summary unavailable."}
          </div>
        </div>
      </div>

      {/* Bottom row — spans both columns */}
      {data.bottomItems.length > 0 && (
        <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "baseline", gap: "1.5rem", paddingTop: "0.75rem", borderTop: "0.0625rem solid var(--border)" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem", flex: 1, minWidth: 0 }}>
            <span style={{ fontSize: "0.5rem", fontFamily: "var(--font-mono), monospace", color: "var(--text-tertiary)", letterSpacing: "0.1em", textTransform: "uppercase" }}>
              {data.bottomLabel}
            </span>
            <div style={{ overflow: "hidden", position: "relative" }}>
              <span className="sediment-concept-marquee" style={{ fontSize: "0.75rem", fontFamily: "var(--font-sans), sans-serif", color: "var(--text-secondary)", lineHeight: 1.3, whiteSpace: "nowrap", display: "inline-block" }}>
                {`${data.bottomItems.join(" · ")}     ${data.bottomItems.join(" · ")}     `}
              </span>
            </div>
          </div>
        </div>
      )}
    </m.div>
  );
}
