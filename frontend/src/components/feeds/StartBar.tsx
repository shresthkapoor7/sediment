"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import styles from "./FeedsView.module.css";

export type StartMode = "feed" | "paper" | "blank";

// Feed and Blank are switched off for now; their code paths stay so they can be turned back on here.
const MODES: { value: StartMode; label: string; disabled?: boolean }[] = [
  { value: "feed", label: "Feed", disabled: true },
  { value: "paper", label: "Paper" },
  { value: "blank", label: "Blank", disabled: true },
];

function StartMenu({ mode, onSelect }: { mode: StartMode; onSelect: (mode: StartMode) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const current = MODES.find(item => item.value === mode) ?? MODES[0];

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
    <button ref={trigger} type="button" className={styles.menuTrigger} aria-expanded={open} aria-controls="start-menu" onClick={() => setOpen(value => !value)}>
      <span className={styles.menuLead}>Start from</span>
      <span className={styles.menuValue}>{current.label}</span>
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m2 3.5 3 3 3-3" /></svg>
    </button>
    {open && <ul id="start-menu" className={styles.menu}>
      {MODES.map(item => <li key={item.value}>
        <button type="button" className={styles.menuItem} aria-pressed={item.value === mode} disabled={item.disabled} onClick={() => { setOpen(false); onSelect(item.value); }}>
          {item.label}
        </button>
      </li>)}
    </ul>}
  </div>;
}

/** The home screen's entry point: choose where to start from, then one field and one button that follow the choice. */
export function StartBar({ mode, onModeChange, markedCount, disabled, adding, searching, onSearch, onAddInterests }: {
  mode: StartMode;
  onModeChange: (mode: StartMode) => void;
  /** Papers marked in the feed. */
  markedCount: number;
  /** The feed is busy or needs a reload. */
  disabled: boolean;
  /** Interests are being submitted. */
  adding: boolean;
  searching?: boolean;
  onSearch?: (query: string) => void;
  /** Resolves true when the interests were saved. */
  onAddInterests: (text: string) => Promise<boolean>;
}) {
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const value = text.trim();

  function select(next: StartMode) {
    if (next === mode) return;
    setText("");
    onModeChange(next);
    requestAnimationFrame(() => input.current?.focus());
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    // Synchronize has nothing to run yet.
    if (mode === "feed" || !value) return;
    if (mode === "paper") { onSearch?.(value); return; }
    if (await onAddInterests(value)) setText("");
  }

  const action = mode === "feed" ? "Synchronize" : mode === "paper" ? "Search" : adding ? "Adding…" : "Add";
  const blocked = mode === "feed" ? markedCount === 0 : mode === "paper" ? !value || !onSearch || !!searching : !value || disabled;

  return <form className={styles.start} onSubmit={submit} aria-label="Start from">
    <StartMenu mode={mode} onSelect={select} />
    {mode === "feed"
      ? <p className={styles.startMessage}>Mark the papers you are interested in and press synchronize.</p>
      : <input ref={input} className={styles.startInput} value={text} onChange={event => setText(event.target.value)} maxLength={mode === "paper" ? 300 : 600} placeholder={mode === "paper" ? "Search a concept or paper" : "Add your interests"} aria-label={mode === "paper" ? "Search a concept or paper" : "Add your interests"} autoComplete="off" />}
    <button type="submit" className={styles.startAction} disabled={blocked}>{action}</button>
  </form>;
}
