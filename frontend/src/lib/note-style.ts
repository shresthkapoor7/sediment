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
    background: "var(--bg-secondary)",
    border: "var(--border)",
    accent: "var(--accent)",
  },
  {
    key: "amber",
    label: "Amber",
    background: "color-mix(in srgb, var(--cat-amber) 10%, var(--bg-secondary) 90%)",
    border: "color-mix(in srgb, var(--cat-amber) 34%, var(--border) 66%)",
    accent: "var(--cat-amber)",
  },
  {
    key: "blue",
    label: "Blue",
    background: "color-mix(in srgb, var(--cat-blue) 10%, var(--bg-secondary) 90%)",
    border: "color-mix(in srgb, var(--cat-blue) 32%, var(--border) 68%)",
    accent: "var(--cat-blue)",
  },
  {
    key: "green",
    label: "Green",
    background: "color-mix(in srgb, var(--cat-green) 10%, var(--bg-secondary) 90%)",
    border: "color-mix(in srgb, var(--cat-green) 30%, var(--border) 70%)",
    accent: "var(--cat-green)",
  },
  {
    key: "rose",
    label: "Rose",
    background: "color-mix(in srgb, var(--cat-rose) 10%, var(--bg-secondary) 90%)",
    border: "color-mix(in srgb, var(--cat-rose) 32%, var(--border) 68%)",
    accent: "var(--cat-rose)",
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
