import { TimelineNote, TimelineNoteKind } from "./types";

export const TIMELINE_NOTE_DEFAULT_WIDTH = 300;
export const TIMELINE_NOTE_MIN_HEIGHT = 176;
export const SPECIAL_NOTE_MIN_HEIGHT = 316;

export function isSpecialNote(note: Pick<TimelineNote, "kind" | "specialNote">): boolean {
  return note.kind === "special_note" || Boolean(note.specialNote);
}

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
    background: "var(--note-paper)",
    border: "transparent",
    accent: "var(--text-secondary)",
  },
  {
    key: "amber",
    label: "Amber",
    background: "var(--note-amber)",
    border: "transparent",
    accent: "var(--cat-amber)",
  },
  {
    key: "blue",
    label: "Blue",
    background: "var(--note-blue)",
    border: "transparent",
    accent: "var(--cat-blue)",
  },
  {
    key: "green",
    label: "Green",
    background: "var(--note-green)",
    border: "transparent",
    accent: "var(--cat-green)",
  },
  {
    key: "rose",
    label: "Rose",
    background: "var(--note-rose)",
    border: "transparent",
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
  if (kind === "special_note") return "SPECIAL NOTE";
  return NOTE_KIND_OPTIONS.find((option) => option.key === kind)?.shortLabel ?? NOTE_KIND_OPTIONS[0].shortLabel;
}
