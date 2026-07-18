import { TimelineNote, TimelineNoteKind } from "./types";

export const TIMELINE_NOTE_DEFAULT_WIDTH = 300;
export const TIMELINE_NOTE_MIN_HEIGHT = 176;

export const NOTE_COLOR_OPTIONS: Array<{
  key: NonNullable<TimelineNote["color"]>;
  label: string;
  background: string;
  border: string;
  accent: string;
}> = [
  {
    key: "paper",
    label: "Paper",
    background: "color-mix(in srgb, var(--bg-secondary) 88%, #f4ead7 12%)",
    border: "color-mix(in srgb, var(--border) 72%, #d7bd8a 28%)",
    accent: "var(--accent)",
  },
  {
    key: "amber",
    label: "Amber",
    background: "color-mix(in srgb, #f6d68b 18%, var(--bg-secondary) 82%)",
    border: "color-mix(in srgb, #f59e0b 38%, var(--border) 62%)",
    accent: "#f59e0b",
  },
  {
    key: "blue",
    label: "Blue",
    background: "color-mix(in srgb, #60a5fa 14%, var(--bg-secondary) 86%)",
    border: "color-mix(in srgb, #60a5fa 34%, var(--border) 66%)",
    accent: "#60a5fa",
  },
  {
    key: "green",
    label: "Green",
    background: "color-mix(in srgb, #34d399 13%, var(--bg-secondary) 87%)",
    border: "color-mix(in srgb, #34d399 32%, var(--border) 68%)",
    accent: "#34d399",
  },
  {
    key: "rose",
    label: "Rose",
    background: "color-mix(in srgb, #fb7185 13%, var(--bg-secondary) 87%)",
    border: "color-mix(in srgb, #fb7185 34%, var(--border) 66%)",
    accent: "#fb7185",
  },
];

export const NOTE_KIND_OPTIONS: Array<{
  key: TimelineNoteKind;
  label: string;
  shortLabel: string;
}> = [
  { key: "field_note", label: "Field note", shortLabel: "FIELD NOTE" },
  { key: "question", label: "Question", shortLabel: "QUESTION" },
  { key: "insight", label: "Insight", shortLabel: "INSIGHT" },
  { key: "todo", label: "Todo", shortLabel: "TODO" },
  { key: "contradiction", label: "Contradiction", shortLabel: "CONTRADICTION" },
];

export function noteColorStyle(color: TimelineNote["color"] = "paper") {
  return NOTE_COLOR_OPTIONS.find((option) => option.key === color) ?? NOTE_COLOR_OPTIONS[0];
}

export function noteKindLabel(kind: TimelineNote["kind"] = "field_note") {
  return NOTE_KIND_OPTIONS.find((option) => option.key === kind)?.shortLabel ?? NOTE_KIND_OPTIONS[0].shortLabel;
}
