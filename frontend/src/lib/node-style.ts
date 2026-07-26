import { NodeBorderColor } from "./types";

const NODE_BORDER_COLOR_MAP: Record<NodeBorderColor, { css: string; label: string }> = {
  accent: { css: "var(--accent)", label: "Accent" },
  blue: { css: "var(--cat-blue)", label: "Blue" },
  green: { css: "var(--cat-green)", label: "Green" },
  purple: { css: "var(--cat-purple)", label: "Purple" },
  amber: { css: "var(--cat-amber)", label: "Amber" },
  rose: { css: "var(--cat-rose)", label: "Rose" },
};

export const NODE_BORDER_COLOR_OPTIONS: Array<{ key: NodeBorderColor; css: string; label: string }> =
  Object.entries(NODE_BORDER_COLOR_MAP).map(([key, value]) => ({
    key: key as NodeBorderColor,
    ...value,
  }));

export function nodeBorderColorCss(color: NodeBorderColor): string {
  return NODE_BORDER_COLOR_MAP[color].css;
}
