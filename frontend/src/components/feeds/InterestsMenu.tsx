"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./FeedsView.module.css";

const iconProps = { width: 14, height: 14, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

// Where a new canvas could start from. The entries are placeholders for now: they close the menu
// and do nothing else.
const OPTIONS = [
  { label: "From feed", icon: <svg {...iconProps}><rect x="2" y="2" width="5" height="7" rx="1" /><rect x="9" y="2" width="5" height="4" rx="1" /><rect x="2" y="11" width="5" height="3" rx="1" /><rect x="9" y="8" width="5" height="6" rx="1" /></svg> },
  { label: "From paper", icon: <svg {...iconProps}><path d="M3 2.5h7l3 3v8H3z" /><path d="M10 2.5v3h3M5.5 8h5M5.5 10.5h5" /></svg> },
  { label: "Start a blank canvas", icon: <svg {...iconProps}><rect x="2.5" y="2.5" width="11" height="11" rx="2" /><path d="M8 5.5v5M5.5 8h5" /></svg> },
];

export function InterestsMenu() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return <div ref={root} className={styles.menuWrap}>
    <button ref={trigger} type="button" className={styles.menuTrigger} aria-expanded={open} aria-controls="interests-menu" onClick={() => setOpen(current => !current)}>
      Your interests
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m2 3.5 3 3 3-3" /></svg>
    </button>
    {open && <ul id="interests-menu" className={styles.menu}>
      {OPTIONS.map(option => <li key={option.label}>
        <button type="button" className={styles.menuItem} onClick={() => setOpen(false)}>{option.icon}{option.label}</button>
      </li>)}
    </ul>}
  </div>;
}
