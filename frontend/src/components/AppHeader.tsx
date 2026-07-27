"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { m, AnimatePresence } from "framer-motion";
import { LogoMark } from "@/components/LogoMark";
import { ThemeToggle } from "@/components/ThemeToggle";
import { TimelineData, TraversalSettings } from "@/lib/types";

const GITHUB_REPO_URL = "https://github.com/shresthkapoor7/sediment";

const THUMB_SIZE = 13;

// Single source of truth for the traversal-settings sliders so the desktop and
// mobile panels can't drift on ranges. Only the label differs per surface.
const TRAVERSAL_SLIDERS = [
  { key: "depth", label: "Depth", min: 1, max: 2 },
  { key: "breadth", label: "Breadth", min: 1, max: 4 },
  { key: "referenceLimit", label: "Reference limit", compactLabel: "Ref limit", min: 5, max: 30 },
  { key: "topN", label: "Top N", min: 1, max: 6 },
] as const;

function SettingsSlider({
  item,
  value,
  onChange,
}: {
  item: { key: string; label: string; min: number; max: number };
  value: number;
  onChange: (v: number) => void;
}) {
  const pct = ((value - item.min) / (item.max - item.min)) * 100;
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          fontSize: "0.71875rem",
          color: "var(--text-secondary)",
          fontFamily: "var(--font-sans), sans-serif",
        }}
      >
        <span style={{ fontWeight: 500 }}>{item.label}</span>
        <span
          style={{
            fontFamily: "var(--font-mono), monospace",
            fontSize: "0.6875rem",
            color: "var(--accent)",
          }}
        >
          {value}
        </span>
      </div>
      <div
        style={{
          position: "relative",
          height: "1.25rem",
          display: "flex",
          alignItems: "center",
        }}
      >
        {/* Track */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            height: "0.1875rem",
            top: "50%",
            transform: "translateY(-50%)",
            borderRadius: "0.125rem",
            background: "var(--bg-tertiary)",
          }}
        />
        {/* Fill */}
        <div
          style={{
            position: "absolute",
            left: 0,
            height: "0.1875rem",
            top: "50%",
            transform: "translateY(-50%)",
            borderRadius: "0.125rem",
            background: "var(--accent)",
            width: `${pct}%`,
          }}
        />
        {/* Thumb */}
        <div
          style={{
            position: "absolute",
            width: THUMB_SIZE,
            height: THUMB_SIZE,
            top: "50%",
            transform: "translateY(-50%)",
            borderRadius: "50%",
            background: "var(--accent)",
            boxShadow: "0 0.0625rem 0.25rem rgba(0,0,0,0.3)",
            pointerEvents: "none",
            left: `calc(${pct}% - ${(pct / 100) * THUMB_SIZE}px)`,
          }}
        />
        {/* Hidden native input */}
        <input
          type="range"
          min={item.min}
          max={item.max}
          value={value}
          onChange={(e) => onChange(Number(e.currentTarget.value))}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            margin: 0,
            opacity: 0,
            cursor: "pointer",
            height: "100%",
          }}
        />
      </div>
    </label>
  );
}

interface AppHeaderProps {
  timelineData: TimelineData | null;
  mobile: boolean;
  searchedQuery: string;
  graphTitle: string;
  graphTitleDraft: string;
  isEditingGraphTitle: boolean;
  canEditGraphTitle: boolean;
  graphTitleInputRef: React.RefObject<HTMLInputElement | null>;
  isSearching: boolean;
  isExpanding: boolean;
  historyOpen: boolean;
  settingsOpen: boolean;
  settings: TraversalSettings;
  draftSettings: TraversalSettings;
  defaultSettings: TraversalSettings;
  sessionActionsOpen: boolean;
  mobileMenuOpen: boolean;
  globalChatOpen: boolean;
  credits: number;
  showCreditsHint: boolean;
  shareState: "idle" | "sharing" | "copied" | "error";
  selectedSeedOpenalexId: string | null;
  landingScrollEl: HTMLDivElement | null;
  setHistoryOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setSettingsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setSettings: React.Dispatch<React.SetStateAction<TraversalSettings>>;
  setDraftSettings: React.Dispatch<React.SetStateAction<TraversalSettings>>;
  setSessionActionsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setMobileMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setShowCreditsHint: React.Dispatch<React.SetStateAction<boolean>>;
  setGraphTitleDraft: React.Dispatch<React.SetStateAction<string>>;
  handleReset: () => void;
  handleExport: () => void;
  handleShare: () => void | Promise<void>;
  handleToggleGlobalChat: () => void;
  startGraphTitleEdit: () => void;
  saveGraphTitle: () => void;
  cancelGraphTitleEdit: () => void;
  runSearch: (
    query: string,
    seedOpenalexId?: string,
    searchSettings?: TraversalSettings,
    requestQuery?: string,
    selectedTraceMode?: "standard" | "deep",
  ) => void | Promise<void>;
}

export function AppHeader({
  timelineData,
  mobile,
  searchedQuery,
  graphTitle,
  graphTitleDraft,
  isEditingGraphTitle,
  canEditGraphTitle,
  graphTitleInputRef,
  isSearching,
  isExpanding,
  historyOpen,
  settingsOpen,
  settings,
  draftSettings,
  defaultSettings,
  sessionActionsOpen,
  mobileMenuOpen,
  globalChatOpen,
  credits,
  showCreditsHint,
  shareState,
  selectedSeedOpenalexId,
  landingScrollEl,
  setHistoryOpen,
  setSettingsOpen,
  setSettings,
  setDraftSettings,
  setSessionActionsOpen,
  setMobileMenuOpen,
  setShowCreditsHint,
  setGraphTitleDraft,
  handleReset,
  handleExport,
  handleShare,
  handleToggleGlobalChat,
  startGraphTitleEdit,
  saveGraphTitle,
  cancelGraphTitleEdit,
  runSearch,
}: AppHeaderProps) {
  // Compaction state lives here so scrolling the landing page (or toggling the
  // graph dock) only re-renders the header — not the whole page tree.
  const [isLandingHeaderCompact, setIsLandingHeaderCompact] = useState(false);
  const [isGraphHeaderCompact, setIsGraphHeaderCompact] = useState(false);

  useEffect(() => {
    // On the graph view the landing scroll container is gone — keep it expanded.
    // Depending on the element itself (passed as state) means this re-attaches
    // exactly when the landing container mounts, regardless of timelineData.
    if (timelineData || !landingScrollEl) {
      setIsLandingHeaderCompact(false);
      return;
    }
    const onScroll = () => setIsLandingHeaderCompact(landingScrollEl.scrollTop > 48);
    onScroll();
    landingScrollEl.addEventListener("scroll", onScroll, { passive: true });
    return () => landingScrollEl.removeEventListener("scroll", onScroll);
  }, [timelineData, landingScrollEl]);

  // Apply is a no-op unless the draft differs from the active settings.
  const settingsChanged =
    draftSettings.depth !== settings.depth ||
    draftSettings.breadth !== settings.breadth ||
    draftSettings.referenceLimit !== settings.referenceLimit ||
    draftSettings.topN !== settings.topN;

  return (
      <m.header
        className={`app-header${!timelineData ? " app-header-landing" : ""}${timelineData ? " app-header-graph" : ""}${(!timelineData && isLandingHeaderCompact) || (timelineData && isGraphHeaderCompact) ? " app-header-compact" : ""}`}
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.75rem",
          minHeight: "4.5rem",
          padding: "0.75rem clamp(1rem, 4vw, 3rem)",
          borderBottom: "0.0625rem solid var(--border)",
          background: "var(--bg-primary)",
          zIndex: !timelineData && historyOpen ? 10 : 50,
          flexShrink: 0,
        }}
      >
        {timelineData && (
          <button
            className="app-header-brand"
            onClick={handleReset}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.625rem",
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--text-primary)",
            }}
          >
            <LogoMark
              width="22"
              height="22"
              style={{ color: "var(--text-primary)" }}
            />
            <span
              style={{
                fontFamily: "var(--font-sans), sans-serif",
                fontSize: "1.125rem",
                fontWeight: 700,
                letterSpacing: "-0.01em",
              }}
            >
              Sediment
            </span>
          </button>
        )}

        <AnimatePresence>
          {(graphTitle || searchedQuery) && (
            <div
              className="app-header-query"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.625rem",
                minWidth: 0,
                overflow: "hidden",
                flexShrink: 1,
              }}
            >
              <m.span
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                style={{
                  fontSize: "0.875rem",
                  color: "var(--text-secondary)",
                  fontFamily: "var(--font-mono), monospace",
                  fontWeight: 500,
                  letterSpacing: "0.02em",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  minWidth: 0,
                }}
              >
                {graphTitle || searchedQuery}
              </m.span>

            </div>
          )}
        </AnimatePresence>

        {/* ── Right side: desktop buttons + always-visible controls ── */}
        <div
          className="app-header-actions"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            flexShrink: 0,
          }}
        >
          {/* Desktop buttons (hidden on mobile) */}
          <div
            className="desktop-only"
            style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
          >
            {timelineData && (
              <button
                type="button"
                className="app-header-labeled-action"
                onClick={handleReset}
                aria-label="Return to Sediment home"
                title="Return to Sediment home"
              >
                <LogoMark
                  className="app-header-sediment-icon"
                  width="16"
                  height="16"
                />
                <span className="app-header-action-label app-header-sediment-label">Sediment</span>
              </button>
            )}

            {timelineData && (graphTitle || searchedQuery) && (
              isEditingGraphTitle ? (
                <form
                  className="app-header-graph-title-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    saveGraphTitle();
                  }}
                >
                  <input
                    ref={graphTitleInputRef}
                    className="app-header-graph-title-input"
                    value={graphTitleDraft}
                    onChange={(event) => setGraphTitleDraft(event.target.value)}
                    onBlur={saveGraphTitle}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        event.preventDefault();
                        cancelGraphTitleEdit();
                      }
                    }}
                    maxLength={200}
                    aria-label="Timeline title"
                  />
                </form>
              ) : canEditGraphTitle ? (
                <button
                  type="button"
                  className="app-header-graph-query app-header-graph-title-button"
                  onClick={startGraphTitleEdit}
                  title="Rename timeline"
                  aria-label={`Rename timeline: ${graphTitle || searchedQuery}`}
                >
                  {graphTitle || searchedQuery}
                </button>
              ) : (
                <span className="app-header-graph-query" title={graphTitle || searchedQuery}>
                  {graphTitle || searchedQuery}
                </span>
              )
            )}

            {!timelineData && (
              <m.button
                type="button"
                className="app-header-labeled-action"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
                onClick={() => {
                  handleReset();
                  // Jump straight to the top — same instant (no-animation) scroll
                  // as the "Trace your own concept" button.
                  landingScrollEl?.scrollTo({ top: 0, behavior: "instant" });
                }}
                aria-label="Sediment home"
              >
                <LogoMark
                  className="app-header-sediment-icon"
                  width="16"
                  height="16"
                />
                <span className="app-header-action-label app-header-sediment-label">Sediment</span>
              </m.button>
            )}

            {!timelineData && (
              <m.button
                className="app-header-labeled-action"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
                onClick={() => setHistoryOpen((open) => !open)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.375rem",
                  padding: "0 0.75rem",
                  height: "2rem",
                  boxSizing: "border-box",
                  background: historyOpen ? "var(--accent-soft)" : "none",
                  border: `0.0625rem solid ${historyOpen ? "var(--accent)" : "var(--border)"}`,
                  borderRadius: "0.4375rem",
                  color: historyOpen
                    ? "var(--accent)"
                    : "var(--text-secondary)",
                  fontSize: "0.75rem",
                  fontFamily: "var(--font-sans), sans-serif",
                  fontWeight: 500,
                  cursor: "pointer",
                  transition:
                    "border-color 0.15s, color 0.15s, background 0.15s",
                }}
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M2.5 3.5h11M2.5 8h11M2.5 12.5h11" />
                  <path d="M4.5 3.5v9" opacity="0.35" />
                </svg>
                <span className="app-header-action-label">History</span>
              </m.button>
            )}

            {!timelineData && (
              <Link
                className="app-header-labeled-action"
                href="/changelog"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.375rem",
                  padding: "0 0.75rem",
                  height: "2rem",
                  boxSizing: "border-box",
                  background: "none",
                  border: "0.0625rem solid var(--border)",
                  borderRadius: "0.4375rem",
                  color: "var(--text-secondary)",
                  fontSize: "0.75rem",
                  fontFamily: "var(--font-sans), sans-serif",
                  fontWeight: 500,
                  textDecoration: "none",
                  transitionProperty: "border-color, color, background",
                  transitionDuration: "0.15s",
                }}
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M3 2.5h7l3 3v8H3z" />
                  <path d="M10 2.5v3h3M5.5 8h5M5.5 10.5h5" />
                </svg>
                <span className="app-header-action-label">Changelog</span>
              </Link>
            )}

            {/* Credits indicator */}
            <div
              className="app-header-credit"
              style={{ position: "relative" }}
              onMouseEnter={() => setShowCreditsHint(true)}
              onMouseLeave={() => setShowCreditsHint(false)}
            >
              {showCreditsHint && (
                <div
                  style={{
                    position: "absolute",
                    top: "calc(100% + 0.5rem)",
                    right: 0,
                    width: "8rem",
                    padding: "0.5rem 0.625rem",
                    borderRadius: "0.5rem",
                    border: "0.0625rem solid var(--border-hover)",
                    background: "var(--bg-secondary)",
                    boxShadow:
                      "0 0.5rem 1.5rem rgba(0,0,0,0.10), 0 0.125rem 0.375rem rgba(0,0,0,0.06)",
                    color: "var(--text-secondary)",
                    fontSize: "0.6875rem",
                    lineHeight: 1.45,
                    zIndex: 110,
                    pointerEvents: "none",
                  }}
                >
                  Daily usage credits
                </div>
              )}
              <div className="app-header-credit-indicator">
                <div className="app-header-credit-visual" aria-hidden="true">
                  <div
                    className="app-header-credit-bars"
                    style={{ display: "flex", flexWrap: "nowrap" }}
                  >
                    {Array.from({ length: 10 }).map((_, i) => {
                      const filled = i < credits;
                      const segColor =
                        credits <= 3
                          ? "var(--cat-rose)"
                          : credits <= 6
                            ? "var(--cat-amber)"
                            : "var(--accent)";
                      return (
                      <div
                        key={i}
                        style={{
                          width: "0.25rem",
                          height: "0.625rem",
                          borderRadius: "0.125rem",
                          background: filled ? segColor : "var(--border)",
                          opacity: filled ? 1 - i * 0.05 : 1,
                        }}
                      />
                      );
                    })}
                    <div
                      style={{
                        width: "0.125rem",
                        height: "0.3125rem",
                        borderRadius: "0 0.0625rem 0.0625rem 0",
                        background: "var(--border)",
                        marginLeft: "0.0625rem",
                      }}
                    />
                  </div>
                  <span
                    className="app-header-credit-ring"
                    aria-hidden="true"
                    style={
                      {
                        "--credit-progress": `${credits * 10}%`,
                      } as React.CSSProperties
                    }
                  />
                </div>
                <span
                  className="app-header-credit-count"
                  role="meter"
                  aria-label="Daily usage credits remaining"
                  aria-valuemin={0}
                  aria-valuemax={10}
                  aria-valuenow={credits}
                  aria-valuetext={`${credits} of 10 daily usage credits remaining`}
                  style={{
                    fontSize: "0.6875rem",
                    color:
                      credits <= 3
                        ? "var(--cat-rose)"
                        : credits <= 6
                          ? "var(--cat-amber)"
                          : "var(--text-tertiary)",
                    fontFamily: "var(--font-mono), monospace",
                    letterSpacing: "0.02em",
                  }}
                >
                  {credits}
                </span>
              </div>
            </div>

            {/* Settings / graph session actions */}
            <div style={{ position: "relative" }}>
              <button
                className={`app-header-labeled-action${timelineData ? " app-header-graph-icon-action" : ""}`}
                onClick={() => {
                  if (timelineData) {
                    setSessionActionsOpen((open) => !open);
                    setSettingsOpen(false);
                    setDraftSettings(settings);
                    return;
                  }
                  setDraftSettings(settings);
                  setSettingsOpen((open) => !open);
                }}
                aria-label={timelineData ? "Session actions" : "Settings"}
                aria-expanded={timelineData ? sessionActionsOpen : settingsOpen}
                title={timelineData ? "Session actions" : undefined}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: timelineData ? 0 : "0.375rem",
                  padding: timelineData ? 0 : "0 0.75rem",
                  width: timelineData ? "2rem" : "auto",
                  height: "2rem",
                  boxSizing: "border-box",
                  background: "none",
                  border: "0.0625rem solid var(--border)",
                  borderRadius: "0.4375rem",
                  color: "var(--text-secondary)",
                  fontSize: "0.75rem",
                  fontFamily: "var(--font-sans), sans-serif",
                  fontWeight: 500,
                  cursor: "pointer",
                  transition: "border-color 0.15s, color 0.15s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "var(--accent)";
                  e.currentTarget.style.color = "var(--accent)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "var(--border)";
                  e.currentTarget.style.color = "var(--text-secondary)";
                }}
              >
                {timelineData ? (
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                    <circle cx="3" cy="8" r="1.35" />
                    <circle cx="8" cy="8" r="1.35" />
                    <circle cx="13" cy="8" r="1.35" />
                  </svg>
                ) : (
                  <>
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M6.5 1.5h3M6 14.5h4M3.5 5.5h9M2.5 10.5h11" />
                      <circle cx="10.5" cy="5.5" r="1.5" />
                      <circle cx="5.5" cy="10.5" r="1.5" />
                    </svg>
                    <span className="app-header-action-label">Settings</span>
                  </>
                )}
              </button>

              <AnimatePresence>
                {(settingsOpen || sessionActionsOpen) && (
                  <m.div
                    initial={{ opacity: 0, y: -6, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -6, scale: 0.98 }}
                    transition={{ duration: 0.15, ease: "easeOut" }}
                    style={{
                      position: "absolute",
                      top: "2.5rem",
                      right: 0,
                      width: timelineData ? "16rem" : "15rem",
                      padding: "0.875rem 0.875rem 0.75rem",
                      background: "var(--bg-secondary)",
                      border: "0.0625rem solid var(--border-hover)",
                      borderRadius: "0.625rem",
                      boxShadow:
                        "0 0.5rem 1.5rem rgba(0,0,0,0.10), 0 0.125rem 0.375rem rgba(0,0,0,0.06)",
                      zIndex: 100,
                      display: "flex",
                      flexDirection: "column",
                      gap: "0.625rem",
                    }}
                  >
                    {timelineData && (
                      <p
                        style={{
                          fontSize: "0.625rem",
                          color: "var(--text-tertiary)",
                          fontFamily: "var(--font-mono), monospace",
                          letterSpacing: "0.06em",
                          textTransform: "uppercase",
                        }}
                      >
                        Session actions
                      </p>
                    )}
                    {timelineData && (
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: "0.125rem",
                          paddingBottom: "0.625rem",
                          borderBottom: "0.0625rem solid var(--border)",
                        }}
                      >
                        <button
                          onClick={() => {
                            handleExport();
                            setSessionActionsOpen(false);
                          }}
                          style={{
                            display: "flex", alignItems: "center", gap: "0.625rem", width: "100%", height: "2rem", padding: "0 0.5rem", border: "none", borderRadius: "0.375rem", background: "none", color: "var(--text-primary)", cursor: "pointer", fontFamily: "var(--font-sans), sans-serif", fontSize: "0.75rem", fontWeight: 500, textAlign: "left",
                          }}
                        >
                          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M8 2v9M4 7l4 4 4-4" /><path d="M2 13h12" /></svg>
                          Export
                        </button>
                        <button
                          onClick={() => void handleShare()}
                          disabled={shareState === "sharing"}
                          style={{
                            display: "flex", alignItems: "center", gap: "0.625rem", width: "100%", height: "2rem", padding: "0 0.5rem", border: "none", borderRadius: "0.375rem", background: "none", color: shareState === "copied" ? "var(--accent)" : "var(--text-primary)", cursor: shareState === "sharing" ? "default" : "pointer", fontFamily: "var(--font-sans), sans-serif", fontSize: "0.75rem", fontWeight: 500, textAlign: "left",
                          }}
                        >
                          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke={shareState === "copied" ? "var(--accent)" : "var(--text-tertiary)"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 3a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM5 8a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM11 9a2 2 0 1 1 0 4 2 2 0 0 1 0-4z" /><path d="M9 4.5l-4 3M9 11.5l-4-3" /></svg>
                          {shareState === "sharing" ? "Sharing…" : shareState === "copied" ? "Link copied" : shareState === "error" ? "Share failed" : "Share"}
                        </button>
                        <a
                          href={GITHUB_REPO_URL}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ display: "flex", alignItems: "center", gap: "0.625rem", width: "100%", height: "2rem", padding: "0 0.5rem", borderRadius: "0.375rem", color: "var(--text-primary)", fontFamily: "var(--font-sans), sans-serif", fontSize: "0.75rem", fontWeight: 500, textDecoration: "none" }}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ color: "var(--text-tertiary)" }} aria-hidden="true">
                            <path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.36-1.34-3.36-1.34-.45-1.15-1.1-1.46-1.1-1.46-.9-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.89 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02A9.5 9.5 0 0 1 12 6.84c.85 0 1.71.11 2.5.34 1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.69-4.57 4.94.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2z" />
                          </svg>
                          GitHub
                        </a>
                        <ThemeToggle className="app-header-graph-session-theme" showLabel fullWidth />
                      </div>
                    )}
                    <p
                      style={{
                        fontSize: "0.625rem",
                        color: "var(--text-tertiary)",
                        fontFamily: "var(--font-mono), monospace",
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                      }}
                    >
                      traversal settings
                    </p>
                    {TRAVERSAL_SLIDERS.map((slider) => (
                      <SettingsSlider
                        key={slider.key}
                        item={{ key: slider.key, label: slider.label, min: slider.min, max: slider.max }}
                        value={draftSettings[slider.key]}
                        onChange={(v) =>
                          setDraftSettings((prev) => ({
                            ...prev,
                            [slider.key]: v,
                          }))
                        }
                      />
                    ))}
                    <p
                      style={{
                        margin: "0.125rem 0 0",
                        fontSize: "0.6875rem",
                        lineHeight: 1.5,
                        color: "var(--text-tertiary)",
                      }}
                    >
                      Daily limits use an anonymous server-derived identifier
                      for abuse prevention and API cost control.
                    </p>
                    <div
                      style={{
                        display: "flex",
                        gap: "0.375rem",
                        alignItems: "center",
                        marginTop: "0.125rem",
                        borderTop: "0.0625rem solid var(--border)",
                        paddingTop: "0.625rem",
                      }}
                    >
                      <button
                        onClick={() => setDraftSettings(defaultSettings)}
                        style={{
                          height: "1.625rem",
                          padding: "0 0.5rem",
                          borderRadius: "0.375rem",
                          border: "none",
                          background: "none",
                          color: "var(--text-tertiary)",
                          cursor: "pointer",
                          fontSize: "0.6875rem",
                          fontFamily: "var(--font-sans), sans-serif",
                          fontWeight: 500,
                          letterSpacing: "0.01em",
                        }}
                      >
                        Reset
                      </button>
                      <div style={{ flex: 1 }} />
                      <button
                        onClick={() => {
                          if (isExpanding) return;
                          setSettings(draftSettings);
                          if (searchedQuery && !isSearching)
                            void runSearch(
                              searchedQuery,
                              selectedSeedOpenalexId ?? undefined,
                              draftSettings,
                            );
                          setSettingsOpen(false);
                          setSessionActionsOpen(false);
                        }}
                        disabled={isExpanding || !settingsChanged}
                        style={{
                          height: "1.625rem",
                          padding: "0 0.625rem",
                          borderRadius: "0.375rem",
                          border: "0.0625rem solid var(--accent)",
                          background: "var(--accent-soft)",
                          color: "var(--accent)",
                          cursor: isExpanding || !settingsChanged ? "default" : "pointer",
                          opacity: settingsChanged ? 1 : 0.45,
                          fontSize: "0.6875rem",
                          fontFamily: "var(--font-sans), sans-serif",
                          fontWeight: 600,
                          letterSpacing: "0.01em",
                        }}
                      >
                        Apply
                      </button>
                    </div>
                  </m.div>
                )}
              </AnimatePresence>
            </div>

            {timelineData && (
              <button
                type="button"
                className="app-header-labeled-action app-header-graph-compact-toggle"
                onClick={() => setIsGraphHeaderCompact((compact) => !compact)}
                aria-label={isGraphHeaderCompact ? "Expand graph dock" : "Collapse graph dock"}
                aria-pressed={isGraphHeaderCompact}
                title={isGraphHeaderCompact ? "Expand dock" : "Collapse dock"}
              >
                {isGraphHeaderCompact ? (
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M6 2H2v4M10 2h4v4M2 10v4h4M14 10v4h-4" />
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                    <path d="M2 4h12M4 8h8M6 12h4" />
                  </svg>
                )}
              </button>
            )}

            <a
              className="app-header-labeled-action app-header-github-action"
              href={GITHUB_REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="View on GitHub"
              style={{
                display: timelineData ? "none" : "flex",
                alignItems: "center",
                justifyContent: "center",
                width: "2rem",
                height: "2rem",
                borderRadius: "0.4375rem",
                border: "0.0625rem solid var(--border)",
                color: "var(--text-secondary)",
                transition: "border-color 0.15s, color 0.15s",
                flexShrink: 0,
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLAnchorElement).style.borderColor =
                  "var(--accent)";
                (e.currentTarget as HTMLAnchorElement).style.color =
                  "var(--accent)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLAnchorElement).style.borderColor =
                  "var(--border)";
                (e.currentTarget as HTMLAnchorElement).style.color =
                  "var(--text-secondary)";
              }}
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M12 2C6.477 2 2 6.477 2 12c0 4.418 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.009-.868-.013-1.703-2.782.604-3.369-1.342-3.369-1.342-.454-1.155-1.11-1.463-1.11-1.463-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0 1 12 6.836a9.59 9.59 0 0 1 2.504.337c1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.741 0 .267.18.578.688.48C19.138 20.163 22 16.418 22 12c0-5.523-4.477-10-10-10z" />
              </svg>
              {!timelineData && (
                <span className="app-header-action-label">GitHub</span>
              )}
            </a>
          </div>

          {/* Always-visible: theme toggle + mobile hamburger */}
          <div
            style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}
          >
            {!timelineData && mobile && (
              <button
                type="button"
                className="show-mobile app-header-mobile-dock-brand app-header-labeled-action"
                onClick={() => {
                  handleReset();
                  landingScrollEl?.scrollTo({ top: 0, behavior: "instant" });
                }}
                aria-label="Sediment home"
              >
                <LogoMark
                  className="app-header-sediment-icon"
                  width="16"
                  height="16"
                />
                <span className="app-header-action-label app-header-sediment-label">Sediment</span>
              </button>
            )}
            {!timelineData && (
              <ThemeToggle
                showLabel
                className="app-header-labeled-action"
              />
            )}

            {timelineData && (
              <button
                className="app-header-graph-icon-action"
                onClick={handleToggleGlobalChat}
                aria-label={globalChatOpen ? "Close timeline sidebar" : "Open timeline sidebar"}
                aria-pressed={globalChatOpen}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "2rem",
                  height: "2rem",
                  background: globalChatOpen ? "var(--accent-soft)" : "none",
                  border: `0.0625rem solid ${globalChatOpen ? "var(--accent)" : "var(--border)"}`,
                  borderRadius: "0.4375rem",
                  color: globalChatOpen ? "var(--accent)" : "var(--text-secondary)",
                  cursor: "pointer",
                  padding: 0,
                  transition: "border-color 0.15s, color 0.15s, background 0.15s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "var(--accent)";
                  e.currentTarget.style.color = "var(--accent)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = globalChatOpen ? "var(--accent)" : "var(--border)";
                  e.currentTarget.style.color = globalChatOpen ? "var(--accent)" : "var(--text-secondary)";
                }}
              >
                <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="2.75" y="3.25" width="14.5" height="13.5" rx="3" />
                  <path d="M8.25 3.5v13" />
                </svg>
              </button>
            )}

            {/* Hamburger — mobile only */}
            <button
              className="show-mobile"
              onClick={() => {
                setMobileMenuOpen((o) => !o);
                setDraftSettings(settings);
              }}
              aria-label="Menu"
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: "0.3rem",
                width: "2rem",
                height: "2rem",
                background: mobileMenuOpen ? "var(--accent-soft)" : "none",
                border: `0.0625rem solid ${mobileMenuOpen ? "var(--accent)" : "var(--border)"}`,
                borderRadius: "0.4375rem",
                cursor: "pointer",
                padding: 0,
                transition: "border-color 0.15s, background 0.15s",
              }}
            >
              {mobileMenuOpen ? (
                /* × close icon */
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 14 14"
                  fill="none"
                  stroke={
                    mobileMenuOpen ? "var(--accent)" : "var(--text-secondary)"
                  }
                  strokeWidth="1.75"
                  strokeLinecap="round"
                >
                  <path d="M2 2l10 10M12 2L2 12" />
                </svg>
              ) : (
                /* ☰ hamburger lines */
                <svg
                  width="14"
                  height="12"
                  viewBox="0 0 14 12"
                  fill="none"
                  stroke="var(--text-secondary)"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                >
                  <path d="M1 1h12M1 6h12M1 11h12" />
                </svg>
              )}
            </button>
          </div>
        </div>
        {/* end right-side wrapper */}

        {/* ── Mobile dropdown menu ── */}
        <AnimatePresence>
          {mobileMenuOpen && (
            <m.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="show-mobile"
              style={{
                position: "absolute",
                top: "100%",
                left: 0,
                right: 0,
                background: "var(--bg-primary)",
                borderBottom: "0.0625rem solid var(--border)",
                boxShadow: "0 0.5rem 1.5rem rgba(0,0,0,0.12)",
                zIndex: 200,
                padding: "0.625rem 1rem 0.875rem",
                display: "flex",
                flexDirection: "column",
                gap: "0.25rem",
              }}
            >
              {/* Credits row */}
              <div
                title="Daily usage credits"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "0.5rem 0.25rem",
                  borderBottom: "0.0625rem solid var(--border)",
                  marginBottom: "0.25rem",
                }}
              >
                <span
                  style={{
                    fontSize: "0.6875rem",
                    color: "var(--text-tertiary)",
                    fontFamily: "var(--font-mono), monospace",
                    letterSpacing: "0.04em",
                  }}
                >
                  credits
                </span>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.375rem",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.125rem",
                    }}
                  >
                    {Array.from({ length: 10 }).map((_, i) => (
                      <div
                        key={i}
                        style={{
                          width: "0.25rem",
                          height: "0.5rem",
                          borderRadius: "0.0625rem",
                          background:
                            i < credits
                              ? credits <= 3
                                ? "var(--cat-rose)"
                                : credits <= 6
                                  ? "var(--cat-amber)"
                                  : "var(--accent)"
                              : "var(--border)",
                          opacity: i < credits ? 1 - i * 0.05 : 1,
                        }}
                      />
                    ))}
                  </div>
                  <span
                    style={{
                      fontSize: "0.6875rem",
                      color:
                        credits <= 3
                          ? "var(--cat-rose)"
                          : credits <= 6
                            ? "var(--cat-amber)"
                            : "var(--accent)",
                      fontFamily: "var(--font-mono), monospace",
                    }}
                  >
                    {credits}
                  </span>
                </div>
              </div>

              {/* History */}
              {!timelineData && (
                <button
                  onClick={() => {
                    setHistoryOpen((o) => !o);
                    setMobileMenuOpen(false);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.625rem",
                    width: "100%",
                    padding: "0.625rem 0.5rem",
                    background: "none",
                    border: "none",
                    borderRadius: "0.5rem",
                    color: "var(--text-primary)",
                    fontSize: "0.875rem",
                    fontFamily: "var(--font-sans), sans-serif",
                    fontWeight: 500,
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "background 0.15s",
                  }}
                  onTouchStart={(e) => {
                    e.currentTarget.style.background = "var(--bg-secondary)";
                  }}
                  onTouchEnd={(e) => {
                    e.currentTarget.style.background = "none";
                  }}
                  onTouchCancel={(e) => {
                    e.currentTarget.style.background = "none";
                  }}
                >
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="var(--text-tertiary)"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M2.5 3.5h11M2.5 8h11M2.5 12.5h11" />
                    <path d="M4.5 3.5v9" opacity="0.35" />
                  </svg>
                  History
                </button>
              )}

              {!timelineData && (
                <Link
                  href="/changelog"
                  onClick={() => setMobileMenuOpen(false)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.625rem",
                    width: "100%",
                    padding: "0.625rem 0.5rem",
                    borderRadius: "0.5rem",
                    color: "var(--text-primary)",
                    fontSize: "0.875rem",
                    fontFamily: "var(--font-sans), sans-serif",
                    fontWeight: 500,
                    textDecoration: "none",
                  }}
                >
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="var(--text-tertiary)"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M3 2.5h7l3 3v8H3z" />
                    <path d="M10 2.5v3h3M5.5 8h5M5.5 10.5h5" />
                  </svg>
                  Changelog
                </Link>
              )}

              {/* Settings — inline sliders */}
              <div style={{ padding: "0.5rem 0.5rem 0.25rem" }}>
                <p
                  style={{
                    fontSize: "0.625rem",
                    color: "var(--text-tertiary)",
                    fontFamily: "var(--font-mono), monospace",
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    marginBottom: "0.625rem",
                  }}
                >
                  traversal settings
                </p>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.625rem",
                  }}
                >
                  {TRAVERSAL_SLIDERS.map((slider) => (
                    <SettingsSlider
                      key={slider.key}
                      item={{
                        key: slider.key,
                        label: "compactLabel" in slider ? slider.compactLabel : slider.label,
                        min: slider.min,
                        max: slider.max,
                      }}
                      value={draftSettings[slider.key]}
                      onChange={(v) =>
                        setDraftSettings((prev) => ({ ...prev, [slider.key]: v }))
                      }
                    />
                  ))}
                </div>
                <p
                  style={{
                    marginTop: "0.625rem",
                    fontSize: "0.75rem",
                    lineHeight: 1.5,
                    color: "var(--text-tertiary)",
                  }}
                >
                  Daily limits use an anonymous server-derived identifier for
                  abuse prevention and API cost control.
                </p>
                <div
                  style={{
                    display: "flex",
                    gap: "0.375rem",
                    marginTop: "0.75rem",
                  }}
                >
                  <button
                    onClick={() => setDraftSettings(defaultSettings)}
                    style={{
                      flex: 1,
                      height: "2.25rem",
                      borderRadius: "0.5rem",
                      border: "0.0625rem solid var(--border)",
                      background: "none",
                      color: "var(--text-secondary)",
                      cursor: "pointer",
                      fontSize: "0.8125rem",
                      fontFamily: "var(--font-sans), sans-serif",
                      fontWeight: 500,
                    }}
                  >
                    Reset
                  </button>
                  <button
                    onClick={() => {
                      if (isExpanding) return;
                      setSettings(draftSettings);
                      if (searchedQuery && !isSearching)
                        void runSearch(
                          searchedQuery,
                          selectedSeedOpenalexId ?? undefined,
                          draftSettings,
                        );
                      setMobileMenuOpen(false);
                    }}
                    disabled={isExpanding || !settingsChanged}
                    style={{
                      flex: 1,
                      height: "2.25rem",
                      borderRadius: "0.5rem",
                      border: "0.0625rem solid var(--accent)",
                      background: "var(--accent)",
                      color: "#fff",
                      cursor: isExpanding || !settingsChanged ? "default" : "pointer",
                      opacity: settingsChanged ? 1 : 0.45,
                      fontSize: "0.8125rem",
                      fontFamily: "var(--font-sans), sans-serif",
                      fontWeight: 600,
                    }}
                  >
                    Apply
                  </button>
                </div>
              </div>

              {/* Divider before action buttons */}
              {timelineData && (
                <div
                  style={{
                    height: "0.0625rem",
                    background: "var(--border)",
                    margin: "0.25rem 0",
                  }}
                />
              )}

              {timelineData && canEditGraphTitle && !isEditingGraphTitle && (
                <button
                  type="button"
                  onClick={startGraphTitleEdit}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.625rem",
                    width: "100%",
                    padding: "0.625rem 0.5rem",
                    background: "none",
                    border: "none",
                    borderRadius: "0.5rem",
                    color: "var(--text-primary)",
                    fontSize: "0.875rem",
                    fontFamily: "var(--font-sans), sans-serif",
                    fontWeight: 500,
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="var(--text-tertiary)"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="m3 11.75 1.1-3.3L11.7.85l3.45 3.45-7.6 7.6L3 12.75z" />
                    <path d="m9.8 2.75 3.45 3.45" />
                  </svg>
                  Rename timeline
                </button>
              )}

              {timelineData && canEditGraphTitle && isEditingGraphTitle && (
                <form
                  className="show-mobile"
                  onSubmit={(event) => {
                    event.preventDefault();
                    saveGraphTitle();
                  }}
                  style={{ display: "flex", gap: "0.5rem", padding: "0.375rem 0.5rem" }}
                >
                  <input
                    ref={graphTitleInputRef}
                    value={graphTitleDraft}
                    onChange={(event) => setGraphTitleDraft(event.target.value)}
                    onBlur={saveGraphTitle}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        event.preventDefault();
                        cancelGraphTitleEdit();
                      }
                    }}
                    maxLength={200}
                    aria-label="Timeline title"
                    style={{
                      flex: 1,
                      minWidth: 0,
                      height: "2.25rem",
                      padding: "0 0.625rem",
                      border: "0.0625rem solid var(--accent)",
                      borderRadius: "0.5rem",
                      outline: "none",
                      background: "var(--bg-secondary)",
                      color: "var(--text-primary)",
                      fontFamily: "var(--font-sans), sans-serif",
                      fontSize: "0.875rem",
                    }}
                  />
                </form>
              )}

              {/* Export */}
              {timelineData && (
                <button
                  onClick={() => {
                    handleExport();
                    setMobileMenuOpen(false);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.625rem",
                    width: "100%",
                    padding: "0.625rem 0.5rem",
                    background: "none",
                    border: "none",
                    borderRadius: "0.5rem",
                    color: "var(--text-primary)",
                    fontSize: "0.875rem",
                    fontFamily: "var(--font-sans), sans-serif",
                    fontWeight: 500,
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                  onTouchStart={(e) => {
                    e.currentTarget.style.background = "var(--bg-secondary)";
                  }}
                  onTouchEnd={(e) => {
                    e.currentTarget.style.background = "none";
                  }}
                  onTouchCancel={(e) => {
                    e.currentTarget.style.background = "none";
                  }}
                >
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="var(--text-tertiary)"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M8 2v9M4 7l4 4 4-4" />
                    <path d="M2 13h12" />
                  </svg>
                  Export Markdown
                </button>
              )}

              {/* Share */}
              {timelineData && (
                <button
                  onClick={() => {
                    void handleShare();
                    setMobileMenuOpen(false);
                  }}
                  disabled={shareState === "sharing"}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.625rem",
                    width: "100%",
                    padding: "0.625rem 0.5rem",
                    background: "none",
                    border: "none",
                    borderRadius: "0.5rem",
                    color:
                      shareState === "copied"
                        ? "var(--accent)"
                        : "var(--text-primary)",
                    fontSize: "0.875rem",
                    fontFamily: "var(--font-sans), sans-serif",
                    fontWeight: 500,
                    cursor: shareState === "sharing" ? "default" : "pointer",
                    textAlign: "left",
                  }}
                  onTouchStart={(e) => {
                    e.currentTarget.style.background = "var(--bg-secondary)";
                  }}
                  onTouchEnd={(e) => {
                    e.currentTarget.style.background = "none";
                  }}
                  onTouchCancel={(e) => {
                    e.currentTarget.style.background = "none";
                  }}
                >
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke={
                      shareState === "copied"
                        ? "var(--accent)"
                        : "var(--text-tertiary)"
                    }
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M11 3a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM5 8a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM11 9a2 2 0 1 1 0 4 2 2 0 0 1 0-4z" />
                    <path d="M9 4.5l-4 3M9 11.5l-4-3" />
                  </svg>
                  {shareState === "sharing"
                    ? "Sharing..."
                    : shareState === "copied"
                      ? "Link copied!"
                      : shareState === "error"
                        ? "Share failed"
                        : "Copy share link"}
                </button>
              )}

              {/* GitHub */}
              <a
                href={GITHUB_REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setMobileMenuOpen(false)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.625rem",
                  padding: "0.625rem 0.5rem",
                  borderRadius: "0.5rem",
                  color: "var(--text-primary)",
                  fontSize: "0.875rem",
                  fontFamily: "var(--font-sans), sans-serif",
                  fontWeight: 500,
                  textDecoration: "none",
                }}
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="var(--text-tertiary)"
                >
                  <path d="M12 2C6.477 2 2 6.477 2 12c0 4.418 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.009-.868-.013-1.703-2.782.604-3.369-1.342-3.369-1.342-.454-1.155-1.11-1.463-1.11-1.463-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0 1 12 6.836a9.59 9.59 0 0 1 2.504.337c1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.741 0 .267.18.578.688.48C19.138 20.163 22 16.418 22 12c0-5.523-4.477-10-10-10z" />
                </svg>
                View source
              </a>
              {timelineData && (
                <ThemeToggle className="app-header-mobile-menu-theme" showLabel fullWidth />
              )}
            </m.div>
          )}
        </AnimatePresence>
      </m.header>
  );
}
