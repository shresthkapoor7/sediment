"use client";

import { useState } from "react";

interface CreditsMeterProps {
  credits: number;
  /** On the home and Workspaces bars it rests as a ring and opens into the bars on click. */
  expandable?: boolean;
  /** Signed in: the avatar sits inside the ring, and rolls to the left of the bars when the meter opens. */
  avatar?: React.ReactNode;
}

/** The daily usage meter: ten bars and a count, or a progress ring that opens into them. */
export function CreditsMeter({ credits, expandable = false, avatar }: CreditsMeterProps) {
  const [creditsExpanded, setCreditsExpanded] = useState(false);
  return (
    <div
      className={`app-header-credit${creditsExpanded ? " app-header-credit-expanded" : ""}${avatar ? " app-header-credit-with-avatar" : ""}`}
      style={{ position: "relative" }}
      title="Daily usage limit"
    >
      <div className="app-header-credit-indicator">
        {expandable && (
          <button
            type="button"
            className="app-header-credit-toggle"
            onClick={() => setCreditsExpanded((open) => !open)}
            aria-expanded={creditsExpanded}
            aria-label={creditsExpanded ? "Collapse usage credits" : "Expand usage credits"}
          />
        )}
        {avatar && <span className="app-header-credit-avatar">{avatar}</span>}
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
  );
}
