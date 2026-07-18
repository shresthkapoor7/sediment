"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";

type ChangelogEntry = {
  id: string;
  pr_number: number;
  title: string;
  summary: string | null;
  merged_at: string;
  author: string;
  pr_url: string;
};

type ChangelogResponse = {
  entries: ChangelogEntry[];
  nextOffset?: number | null;
  hasMore: boolean;
};

const CHANGELOG_PAGE_SIZE = 10;

const TAG_COLORS = {
  accent: {
    bg: "var(--accent-soft)",
    text: "var(--accent)",
  },
  green: {
    bg: "rgba(34, 197, 94, 0.12)",
    text: "rgb(34, 197, 94)",
  },
  blue: {
    bg: "rgba(59, 130, 246, 0.12)",
    text: "rgb(59, 130, 246)",
  },
  purple: {
    bg: "rgba(168, 85, 247, 0.12)",
    text: "rgb(168, 85, 247)",
  },
  gray: {
    bg: "rgba(156, 163, 175, 0.12)",
    text: "rgb(156, 163, 175)",
  },
};

type Category = {
  label: string;
  color: keyof typeof TAG_COLORS;
};

function detectCategories(summary: string | null): Category[] {
  if (!summary) return [];

  const categories: Category[] = [];

  if (/\*\*new features?\*\*|\*\*features?\*\*/i.test(summary)) {
    categories.push({ label: "New Feature", color: "accent" });
  }
  if (/\*\*bug fix(es)?\*\*/i.test(summary)) {
    categories.push({ label: "Bug Fix", color: "green" });
  }
  if (/\*\*styl(e|ing)\*\*/i.test(summary)) {
    categories.push({ label: "Style", color: "blue" });
  }
  if (/\*\*(chores?|refactor(ing)?|infrastructure)\*\*/i.test(summary)) {
    categories.push({ label: "Chores", color: "purple" });
  }
  if (/\*\*(documentation|docs)\*\*/i.test(summary)) {
    categories.push({ label: "Docs", color: "gray" });
  }
  if (/\*\*(tests?|testing)\*\*/i.test(summary)) {
    categories.push({ label: "Tests", color: "purple" });
  }

  return categories;
}

function formatDate(isoDate: string): string {
  const date = new Date(isoDate);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function parseTitle(title: string): { prefix: string; rest: string } {
  const match = title.match(/^sediment:\s*(.*)$/i);
  if (match) {
    return { prefix: "sediment", rest: match[1] };
  }
  return { prefix: "", rest: title };
}

function cleanSummary(summary: string): string {
  return summary
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\[!\[.*?\]\(.*?\)\]\(.*?\)/g, "")
    .replace(/!\[.*?\]\(.*?\)/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function ChangelogCard({ entry }: { entry: ChangelogEntry }) {
  const { rest: displayTitle } = parseTitle(entry.title);
  const categories = detectCategories(entry.summary);
  const dotColor = categories.length > 0 ? TAG_COLORS[categories[0].color] : TAG_COLORS.accent;

  return (
    <div
      style={{
        display: "flex",
        gap: "1.5rem",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          paddingTop: "0.25rem",
        }}
      >
        <div
          style={{
            width: "0.75rem",
            height: "0.75rem",
            borderRadius: "50%",
            background: dotColor.text,
            boxShadow: `0 0 0.5rem ${dotColor.text}40`,
            flexShrink: 0,
          }}
        />
        <div
          style={{
            width: "0.125rem",
            flex: 1,
            background: "var(--border)",
            marginTop: "0.5rem",
          }}
        />
      </div>

      <div style={{ flex: 1, paddingBottom: "2rem" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            marginBottom: "0.75rem",
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "0.75rem",
              color: "var(--text-tertiary)",
              letterSpacing: "0.02em",
            }}
          >
            {formatDate(entry.merged_at)}
          </span>
          <a
            href={entry.pr_url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              padding: "0.25rem 0.5rem",
              borderRadius: "0.25rem",
              background: TAG_COLORS.accent.bg,
              color: TAG_COLORS.accent.text,
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "0.6875rem",
              fontWeight: 500,
              letterSpacing: "0.02em",
              textDecoration: "none",
            }}
          >
            PR #{entry.pr_number}
          </a>
          {categories.map((cat) => {
            const catColors = TAG_COLORS[cat.color];
            return (
              <span
                key={cat.label}
                style={{
                  padding: "0.25rem 0.5rem",
                  borderRadius: "0.25rem",
                  background: catColors.bg,
                  color: catColors.text,
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: "0.6875rem",
                  fontWeight: 500,
                  letterSpacing: "0.02em",
                }}
              >
                {cat.label}
              </span>
            );
          })}
        </div>

        <div
          style={{
            background: "var(--node-bg)",
            border: "0.0625rem solid var(--border)",
            borderRadius: "0.75rem",
            padding: "1.25rem 1.5rem",
            boxShadow: "var(--node-shadow)",
          }}
        >
          <h3
            style={{
              fontSize: "1rem",
              fontWeight: 600,
              lineHeight: 1.4,
              marginBottom: entry.summary ? "0.5rem" : 0,
            }}
          >
            <a
              href={entry.pr_url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: "var(--text-primary)",
                textDecoration: "none",
              }}
            >
              {displayTitle}
            </a>
          </h3>
          {entry.summary && (
            <div
              className="changelog-summary"
              style={{
                fontSize: "0.9375rem",
                lineHeight: 1.6,
                color: "var(--text-secondary)",
              }}
            >
              <ReactMarkdown
                components={{
                  p: ({ children }) => (
                    <p style={{ margin: "0 0 0.75rem 0" }}>{children}</p>
                  ),
                  ul: ({ children }) => (
                    <ul
                      style={{
                        margin: "0.5rem 0",
                        paddingLeft: "1.25rem",
                        listStyleType: "disc",
                      }}
                    >
                      {children}
                    </ul>
                  ),
                  ol: ({ children }) => (
                    <ol
                      style={{
                        margin: "0.5rem 0",
                        paddingLeft: "1.25rem",
                      }}
                    >
                      {children}
                    </ol>
                  ),
                  li: ({ children }) => (
                    <li style={{ margin: "0.25rem 0" }}>{children}</li>
                  ),
                  strong: ({ children }) => (
                    <strong
                      style={{ fontWeight: 600, color: "var(--text-primary)" }}
                    >
                      {children}
                    </strong>
                  ),
                  a: ({ href, children }) => (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: "var(--accent)" }}
                    >
                      {children}
                    </a>
                  ),
                  code: ({ children }) => (
                    <code
                      style={{
                        background: "var(--bg-tertiary)",
                        padding: "0.125rem 0.375rem",
                        borderRadius: "0.25rem",
                        fontSize: "0.875em",
                        fontFamily: "'JetBrains Mono', monospace",
                      }}
                    >
                      {children}
                    </code>
                  ),
                }}
              >
                {cleanSummary(entry.summary)}
              </ReactMarkdown>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ChangelogPage() {
  const [entries, setEntries] = useState<ChangelogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextOffset, setNextOffset] = useState<number | null>(0);
  const [error, setError] = useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [isHeaderCompact, setIsHeaderCompact] = useState(false);

  useEffect(() => {
    document.title = "Changelog — Sediment";
    document.body.style.overflow = "auto";

    const controller = new AbortController();

    fetch(`/api/changelog?limit=${CHANGELOG_PAGE_SIZE}&offset=0`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch changelog");
        return res.json();
      })
      .then((data: ChangelogResponse) => {
        setEntries(data.entries || []);
        setHasMore(Boolean(data.hasMore));
        setNextOffset(data.nextOffset ?? null);
        setLoading(false);
      })
      .catch((err) => {
        if (err.name === "AbortError") return;
        setError(err.message);
        setLoading(false);
      });

    return () => {
      controller.abort();
      document.body.style.overflow = "";
    };
  }, []);

  useEffect(() => {
    const updateHeader = () => setIsHeaderCompact(window.scrollY > 48);
    updateHeader();
    window.addEventListener("scroll", updateHeader, { passive: true });
    return () => window.removeEventListener("scroll", updateHeader);
  }, []);

  function loadMore() {
    if (loadingMore || nextOffset === null) return;
    setLoadingMore(true);
    setLoadMoreError(null);
    fetch(`/api/changelog?limit=${CHANGELOG_PAGE_SIZE}&offset=${nextOffset}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch changelog");
        return res.json();
      })
      .then((data: ChangelogResponse) => {
        setEntries((current) => {
          const existing = new Set(current.map((entry) => entry.id));
          return [
            ...current,
            ...(data.entries || []).filter((entry) => !existing.has(entry.id)),
          ];
        });
        setHasMore(Boolean(data.hasMore));
        setNextOffset(data.nextOffset ?? null);
      })
      .catch((err) => {
        setLoadMoreError(err.message);
      })
      .finally(() => {
        setLoadingMore(false);
      });
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--bg-primary)",
        overflow: "auto",
      }}
    >
      <header
        className={`changelog-dock${isHeaderCompact ? " changelog-dock-compact" : ""}`}
        style={{
          position: "fixed",
          top: "1.25rem",
          left: 0,
          right: 0,
          zIndex: 10,
          padding: "0 1rem",
          pointerEvents: "none",
        }}
      >
        <div
          className="changelog-dock-content"
          style={{
            width: "max-content",
            maxWidth: "100%",
            margin: "0 auto",
            padding: "0.3125rem 0.375rem",
            display: "flex",
            alignItems: "center",
            gap: "0.125rem",
            border: "0.0625rem solid color-mix(in srgb, var(--border) 72%, transparent)",
            borderRadius: "0.875rem",
            background: "color-mix(in srgb, var(--bg-primary) 82%, transparent)",
            boxShadow: "0 0.625rem 1.75rem rgba(0, 0, 0, 0.12)",
            backdropFilter: "blur(16px)",
            pointerEvents: "auto",
          }}
        >
          <Link
            href="/"
            className="changelog-dock-item"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.375rem",
              height: "2rem",
              padding: "0 0.625rem",
              borderRadius: "0.5rem",
              textDecoration: "none",
              color: "var(--text-secondary)",
              fontFamily: "'DM Sans', sans-serif",
              fontSize: "0.75rem",
              fontWeight: 500,
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M2 7l10-5 10 5-10 5L2 7z" />
              <path d="M2 12l10 5 10-5" opacity="0.65" />
              <path d="M2 17l10 5 10-5" opacity="0.35" />
            </svg>
            <span className="changelog-dock-label">Sediment</span>
          </Link>

          <span className="changelog-dock-divider" style={{ width: "0.0625rem", height: "1.25rem", background: "var(--border)", margin: "0 0.125rem" }} />

          <span
            className="changelog-dock-item"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.375rem",
              height: "2rem",
              padding: "0 0.625rem",
              borderRadius: "0.5rem",
              background: "color-mix(in srgb, var(--accent) 9%, transparent)",
              color: "var(--text-primary)",
              fontFamily: "'DM Sans', sans-serif",
              fontSize: "0.75rem",
              fontWeight: 500,
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M3 2.5h7l3 3v8H3z" />
              <path d="M10 2.5v3h3M5.5 8h5M5.5 10.5h5" />
            </svg>
            <span className="changelog-dock-label">Changelog</span>
          </span>

          <span className="changelog-dock-divider" style={{ width: "0.0625rem", height: "1.25rem", background: "var(--border)", margin: "0 0.125rem" }} />

          <Link
            href="/"
            className="changelog-dock-item"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.375rem",
              height: "2rem",
              padding: "0 0.625rem",
              borderRadius: "0.5rem",
              color: "var(--text-secondary)",
              fontFamily: "'DM Sans', sans-serif",
              fontSize: "0.75rem",
              fontWeight: 500,
              textDecoration: "none",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M13 8H3" />
              <path d="M7 4l-4 4 4 4" />
            </svg>
            <span className="changelog-dock-label">Back</span>
          </Link>
        </div>
      </header>

      <main
        style={{
          maxWidth: "48rem",
          margin: "0 auto",
          padding: "6rem 1.5rem 6rem",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: "3rem" }}>
          <p
            style={{
              fontSize: "1.125rem",
              lineHeight: 1.6,
              color: "var(--text-secondary)",
              maxWidth: "28rem",
              margin: "0 auto",
            }}
          >
            New features, improvements, and fixes. Follow along as Sediment
            evolves.
          </p>
        </div>

        {loading && (
          <div
            style={{
              textAlign: "center",
              padding: "4rem 0",
              color: "var(--text-tertiary)",
            }}
          >
            Loading...
          </div>
        )}

        {error && (
          <div
            style={{
              textAlign: "center",
              padding: "4rem 0",
              color: "var(--text-secondary)",
            }}
          >
            {error}
          </div>
        )}

        {!loading && !error && entries.length === 0 && (
          <div
            style={{
              textAlign: "center",
              padding: "4rem 0",
              color: "var(--text-tertiary)",
            }}
          >
            No changelog entries yet.
          </div>
        )}

        {!loading && !error && entries.length > 0 && (
          <div>
            {entries.map((entry) => (
              <ChangelogCard key={entry.id} entry={entry} />
            ))}
            {hasMore && (
              <div style={{ textAlign: "center", marginTop: "1rem" }}>
                <button
                  onClick={loadMore}
                  disabled={loadingMore}
                  style={{
                    padding: "0.75rem 1.125rem",
                    borderRadius: "0.625rem",
                    border: "0.0625rem solid var(--border-hover)",
                    background: "var(--bg-secondary)",
                    color: loadingMore ? "var(--text-tertiary)" : "var(--accent)",
                    cursor: loadingMore ? "default" : "pointer",
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: "0.75rem",
                    letterSpacing: "0.04em",
                  }}
                >
                  {loadingMore ? "Loading..." : "Load more"}
                </button>
              </div>
            )}
            {loadMoreError && (
              <p
                style={{
                  marginTop: "0.75rem",
                  textAlign: "center",
                  color: "var(--text-tertiary)",
                  fontSize: "0.8125rem",
                }}
              >
                {loadMoreError}
              </p>
            )}
          </div>
        )}

        <div
          style={{
            marginTop: "2rem",
            paddingTop: "2rem",
            borderTop: "0.0625rem solid var(--border)",
            textAlign: "center",
          }}
        >
          <p
            style={{
              fontSize: "0.875rem",
              color: "var(--text-tertiary)",
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            More updates coming soon.
          </p>
        </div>
      </main>
    </div>
  );
}
