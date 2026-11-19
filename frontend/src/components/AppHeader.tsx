"use client";

import Link from "next/link";
import { useState } from "react";
import { m, AnimatePresence } from "framer-motion";
import { LogoMark } from "@/components/LogoMark";
import { GraphDescription } from "@/components/GraphDescription";
import { CreditsMeter } from "@/components/CreditsMeter";
import { TimelineData } from "@/lib/types";

const MotionLink = m.create(Link);


interface AppHeaderProps {
  timelineData: TimelineData | null;
  mobile: boolean;
  searchedQuery: string;
  graphTitle: string;
  graphDescription: string;
  onSaveGraphDescription?: (description: string) => void;
  graphTitleDraft: string;
  isEditingGraphTitle: boolean;
  canEditGraphTitle: boolean;
  graphTitleInputRef: React.RefObject<HTMLInputElement | null>;
  mobileMenuOpen: boolean;
  globalChatOpen: boolean;
  credits: number;
  shareState: "idle" | "sharing" | "copied" | "error";
  landingScrollEl: HTMLDivElement | null;
  setMobileMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setGraphTitleDraft: React.Dispatch<React.SetStateAction<string>>;
  handleReset: () => void;
  handleExport: () => void;
  handleShare: () => void | Promise<void>;
  handleToggleGlobalChat: () => void;
  startGraphTitleEdit: () => void;
  saveGraphTitle: () => void;
  cancelGraphTitleEdit: () => void;
}

export function AppHeader({
  timelineData,

  searchedQuery,
  graphTitle,
  graphDescription,
  onSaveGraphDescription,
  graphTitleDraft,
  isEditingGraphTitle,
  canEditGraphTitle,
  graphTitleInputRef,
  mobileMenuOpen,
  globalChatOpen,
  credits,
  landingScrollEl,
  setMobileMenuOpen,
  setGraphTitleDraft,
  handleReset,
  handleExport,
  handleToggleGlobalChat,
  startGraphTitleEdit,
  saveGraphTitle,
  cancelGraphTitleEdit,
}: AppHeaderProps) {
  // Compaction state lives here so toggling the graph dock only re-renders the
  // header — not the whole page tree. The home header never collapses: it scrolls
  // away with the page.
  const [isGraphHeaderCompact, setIsGraphHeaderCompact] = useState(false);

  return (
      <m.header
        className={`app-header${!timelineData ? " app-header-landing" : ""}${timelineData ? " app-header-graph" : ""}${timelineData && isGraphHeaderCompact ? " app-header-compact" : ""}`}
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
          zIndex: 50,
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
              <div className="app-header-graph-center">
              {isEditingGraphTitle ? (
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
              )}
              {!isEditingGraphTitle && (
                <GraphDescription description={graphDescription} onSave={onSaveGraphDescription} />
              )}
              </div>
            )}

            {!timelineData && (
              <m.button
                type="button"
                className="app-header-labeled-action app-header-home-brand"
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
              <MotionLink
                href="/workspaces"
                className="app-header-labeled-action app-header-workspaces"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.375rem",
                  padding: "0 0.75rem",
                  height: "2rem",
                  boxSizing: "border-box",
                  border: "0.0625rem solid var(--border)",
                  borderRadius: "0.4375rem",
                  color: "var(--text-secondary)",
                  fontSize: "0.75rem",
                  fontFamily: "var(--font-sans), sans-serif",
                  fontWeight: 500,
                  textDecoration: "none",
                  cursor: "pointer",
                  transition: "border-color 0.15s, color 0.15s",
                }}
              >
                <span className="app-header-action-label">Workspaces</span>
              </MotionLink>
            )}

            {/* Credits indicator */}
            <CreditsMeter credits={credits} expandable={!timelineData} />

            {/* Canvas actions sit in the bar itself. */}
            {timelineData && (
              <>
                <button type="button" className="app-header-labeled-action" onClick={handleExport} title="Export markdown">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 2.5v7.5M5 7.5l3 3 3-3M3 13h10" /></svg>
                  <span className="app-header-action-label">Export</span>
                </button>
              </>
            )}

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
          </div>

          {/* Canvas controls: the agent toggle and, on mobile, the menu */}
          <div
            style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}
          >

            {timelineData && (
              <button
                className="app-header-graph-icon-action"
                onClick={handleToggleGlobalChat}
                aria-label={globalChatOpen ? "Close agent" : "Open agent"}
                title={globalChatOpen ? "Close agent" : "Open agent"}
                aria-pressed={globalChatOpen}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "2rem",
                  height: "2rem",
                  background: globalChatOpen ? "var(--bg-tertiary)" : "none",
                  border: "none",
                  borderRadius: "0.4375rem",
                  color: globalChatOpen ? "var(--text-primary)" : "var(--text-secondary)",
                  cursor: "pointer",
                  padding: 0,
                  transition: "color 0.15s, background 0.15s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = "var(--text-primary)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = globalChatOpen ? "var(--text-primary)" : "var(--text-secondary)";
                }}
              >
                <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="2.75" y="3.25" width="14.5" height="13.5" rx="3" />
                  <path d="M8.25 3.5v13" />
                </svg>
              </button>
            )}

            {/* Hamburger — canvases on mobile only */}
            {timelineData && <button
              className="show-mobile"
              onClick={() => {
                setMobileMenuOpen((o) => !o);
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
            </button>}
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
                title="Daily usage limit"
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


            </m.div>
          )}
        </AnimatePresence>
      </m.header>
  );
}
