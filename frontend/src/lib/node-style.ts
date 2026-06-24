import { NodeBorderColor } from "./types";

export const NODE_BORDER_COLOR_OPTIONS: Array<{ key: NodeBorderColor; css: string; label: string }> = [
  { key: "accent", css: "var(--accent)", label: "Accent" },
  { key: "blue", css: "#60a5fa", label: "Blue" },
  { key: "green", css: "#34d399", label: "Green" },
  { key: "purple", css: "#a78bfa", label: "Purple" },
  { key: "amber", css: "#f59e0b", label: "Amber" },
  { key: "rose", css: "#fb7185", label: "Rose" },
];

export function nodeBorderColorCss(color: NodeBorderColor): string {
  return NODE_BORDER_COLOR_OPTIONS.find((option) => option.key === color)?.css ?? "var(--accent)";
}
