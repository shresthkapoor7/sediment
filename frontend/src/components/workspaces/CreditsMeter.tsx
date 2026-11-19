"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { fetchUsage } from "@/lib/api";
import styles from "./WorkspacesView.module.css";

/** The daily usage meter from the home header: a ring that opens into ten bars and a count. */
export function CreditsMeter() {
  const [credits, setCredits] = useState<number | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let active = true;
    fetchUsage()
      .then((data) => { if (active) setCredits(data.segments); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  if (credits === null) return null;
  const tone = credits <= 3 ? "var(--cat-rose)" : credits <= 6 ? "var(--cat-amber)" : "var(--accent)";

  return (
    <button
      type="button"
      className={styles.credits}
      onClick={() => setOpen((value) => !value)}
      aria-expanded={open}
      aria-label={`${credits} of 10 daily usage credits remaining`}
      title="Daily usage limit"
    >
      {open ? (
        <>
          <span className={styles.creditBars} aria-hidden="true">
            {Array.from({ length: 10 }, (_, i) => (
              <span key={i} style={{ background: i < credits ? tone : "var(--border)", opacity: i < credits ? 1 - i * 0.05 : 1 }} />
            ))}
          </span>
          <span className={styles.creditCount} style={{ color: tone }}>{credits}</span>
        </>
      ) : (
        <span className={styles.creditRing} aria-hidden="true" style={{ "--credit-progress": `${credits * 10}%` } as CSSProperties} />
      )}
    </button>
  );
}
