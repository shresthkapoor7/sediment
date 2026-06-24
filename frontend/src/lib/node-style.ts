import { NodeBorderColor } from "./types";

const NODE_BORDER_COLOR_MAP: Record<NodeBorderColor, { css: string; label: string }> = {
  accent: { css: "var(--accent)", label: "Accent" },
  blue: { css: "#60a5fa", label: "Blue" },
  green: { css: "#34d399", label: "Green" },
  purple: { css: "#a78bfa", label: "Purple" },
  amber: { css: "#f59e0b", label: "Amber" },
  rose: { css: "#fb7185", label: "Rose" },
};

export const NODE_BORDER_COLOR_OPTIONS: Array<{ key: NodeBorderColor; css: string; label: string }> =
  Object.entries(NODE_BORDER_COLOR_MAP).map(([key, value]) => ({
    key: key as NodeBorderColor,
    ...value,
  }));

export function nodeBorderColorCss(color: NodeBorderColor): string {
  return NODE_BORDER_COLOR_MAP[color].css;
}
