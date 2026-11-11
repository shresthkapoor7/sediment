"use client";

import { useEffect, useRef, type ReactNode } from "react";
import type { CategoryLook } from "@/lib/workspaces";
import styles from "./CategoryStyle.module.css";

// What a category can look like: an icon from this set and a colour from this palette. Both are stored by id.
const svg = (children: ReactNode, size = 14) =>
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;

export const CATEGORY_ICONS: { id: string; label: string; paths: ReactNode }[] = [
  { id: "folder", label: "Folder", paths: <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3H6l1.5 1.8h5A1.5 1.5 0 0 1 14 6.3v5.2a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z" /> },
  { id: "briefcase", label: "Briefcase", paths: <><rect x="2" y="5" width="12" height="8" rx="1.5" /><path d="M6 5V3.8c0-.4.3-.8.8-.8h2.4c.5 0 .8.4.8.8V5M2 8.5h12" /></> },
  { id: "user", label: "Person", paths: <><circle cx="8" cy="5.5" r="2.5" /><path d="M3 13.5c.4-2.4 2.4-3.8 5-3.8s4.6 1.4 5 3.8" /></> },
  { id: "book", label: "Book", paths: <><path d="M3 3.5A1.5 1.5 0 0 1 4.5 2H13v10H4.5A1.5 1.5 0 0 0 3 13.5z" /><path d="M3 13.5A1.5 1.5 0 0 0 4.5 15H13v-3" /></> },
  { id: "star", label: "Star", paths: <path d="m8 2 1.8 3.7 4 .6-2.9 2.8.7 4L8 11.2l-3.6 1.9.7-4L2.2 6.3l4-.6z" /> },
  { id: "heart", label: "Heart", paths: <path d="M8 13.5S2.5 10 2.5 6.3A2.8 2.8 0 0 1 8 5.2a2.8 2.8 0 0 1 5.5 1.1C13.5 10 8 13.5 8 13.5z" /> },
  { id: "bookmark", label: "Bookmark", paths: <path d="M4 2.5h8v11l-4-2.8-4 2.8z" /> },
  { id: "flask", label: "Flask", paths: <path d="M6.2 2.5h3.6M7 2.5v4L3.2 12.2a1 1 0 0 0 .9 1.5h7.8a1 1 0 0 0 .9-1.5L9 6.5v-4M5 10h6" /> },
  { id: "code", label: "Code", paths: <path d="m5.5 4.5-3 3.5 3 3.5M10.5 4.5l3 3.5-3 3.5" /> },
  { id: "globe", label: "Globe", paths: <><circle cx="8" cy="8" r="5.5" /><path d="M2.5 8h11M8 2.5c1.8 1.7 2.7 3.5 2.7 5.5S9.8 11.8 8 13.5c-1.8-1.7-2.7-3.5-2.7-5.5S6.2 4.2 8 2.5z" /></> },
  { id: "bolt", label: "Bolt", paths: <path d="M9 2 3.5 9h4l-.5 5L12.5 7h-4z" /> },
  { id: "idea", label: "Idea", paths: <path d="M6 12.5h4M6.5 14h3M8 2a4 4 0 0 0-2.2 7.3c.4.3.7.8.7 1.2v.5h3v-.5c0-.4.3-.9.7-1.2A4 4 0 0 0 8 2z" /> },
];

// `value` is undefined for the neutral default.
export const CATEGORY_COLORS: { id: string; label: string; value?: string }[] = [
  { id: "default", label: "Default" },
  { id: "blue", label: "Blue", value: "var(--cat-blue)" },
  { id: "green", label: "Green", value: "var(--cat-green)" },
  { id: "purple", label: "Purple", value: "var(--cat-purple)" },
  { id: "amber", label: "Amber", value: "var(--cat-amber)" },
  { id: "rose", label: "Rose", value: "var(--cat-rose)" },
];

export const colorValue = (id?: string) => CATEGORY_COLORS.find(color => color.id === id)?.value;

export function CategoryIcon({ icon, size = 14 }: { icon?: string; size?: number }) {
  const found = CATEGORY_ICONS.find(item => item.id === icon) ?? CATEGORY_ICONS[0];
  return svg(found.paths, size);
}

/** The popover behind a category's icon tile: pick an icon and a colour. Closes on outside click or Esc. */
export function CategoryPicker({ look, onChange, onClose }: { look: CategoryLook; onChange: (next: CategoryLook) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) onClose(); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } };
    // Defer one tick so the click that opened the popover doesn't immediately close it.
    const timer = window.setTimeout(() => document.addEventListener("pointerdown", away), 0);
    document.addEventListener("keydown", key, true);
    return () => { window.clearTimeout(timer); document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", key, true); };
  }, [onClose]);

  const icon = look.icon ?? "folder", color = look.color ?? "default";
  return <div ref={ref} className={styles.picker} role="dialog" aria-label="Category icon and colour">
    <div className={styles.icons} role="radiogroup" aria-label="Icon">
      {CATEGORY_ICONS.map(item => <button key={item.id} type="button" role="radio" aria-checked={icon === item.id} aria-label={item.label} title={item.label}
        className={styles.iconOption} onClick={() => onChange({ ...look, icon: item.id })}>{svg(item.paths, 15)}</button>)}
    </div>
    <div className={styles.colors} role="radiogroup" aria-label="Colour">
      {CATEGORY_COLORS.map(item => <button key={item.id} type="button" role="radio" aria-checked={color === item.id} aria-label={item.label} title={item.label}
        className={`${styles.swatch} ${item.value ? "" : styles.swatchDefault}`} style={item.value ? { background: item.value } : undefined}
        onClick={() => onChange({ ...look, color: item.id })} />)}
    </div>
  </div>;
}
