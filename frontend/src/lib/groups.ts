import { NODE_DIMENSIONS } from "./layout-constants";
import { TimelineNode } from "./types";

/** Space between a cluster's papers and the edge of its frame, and the height of its name row. */
export const GROUP_PADDING = 24;
export const GROUP_LABEL_HEIGHT = 40;

export interface GroupRegion {
  key: string;
  label: string;
  count: number;
  /** Bounding box of the member cards. */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface Frame { x: number; y: number; width: number; height: number }

export function groupKey(label: string | null | undefined): string {
  return (label ?? "").trim().toLowerCase();
}

/** One region per cluster name. `excludeNodeId` leaves a card out, e.g. the one being dragged. */
export function computeGroupRegions(nodes: Iterable<TimelineNode>, excludeNodeId?: number | null): GroupRegion[] {
  const regions = new Map<string, GroupRegion>();
  for (const node of nodes) {
    const label = node.group?.trim();
    if (!label || node.id === excludeNodeId) continue;
    const key = groupKey(label);
    const region = regions.get(key) ?? { key, label, count: 0, minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    region.minX = Math.min(region.minX, node.x);
    region.minY = Math.min(region.minY, node.y);
    region.maxX = Math.max(region.maxX, node.x + NODE_DIMENSIONS.width);
    region.maxY = Math.max(region.maxY, node.y + NODE_DIMENSIONS.height);
    region.count += 1;
    regions.set(key, region);
  }
  return [...regions.values()];
}

/** The frame drawn for a cluster: its papers plus padding and the name row. */
export function regionFrame(region: GroupRegion): Frame {
  return {
    x: region.minX - GROUP_PADDING,
    y: region.minY - GROUP_PADDING - GROUP_LABEL_HEIGHT,
    width: region.maxX - region.minX + GROUP_PADDING * 2,
    height: region.maxY - region.minY + GROUP_PADDING * 2 + GROUP_LABEL_HEIGHT,
  };
}

export function frameContains(frame: Frame, x: number, y: number): boolean {
  return x >= frame.x && x <= frame.x + frame.width && y >= frame.y && y <= frame.y + frame.height;
}

export function cardCenter(node: Pick<TimelineNode, "x" | "y">): { x: number; y: number } {
  return { x: node.x + NODE_DIMENSIONS.width / 2, y: node.y + NODE_DIMENSIONS.height / 2 };
}

/** The cluster whose frame a card sits in, judged by the card's centre. The smallest frame wins. */
export function regionAt(regions: GroupRegion[], node: Pick<TimelineNode, "x" | "y">): GroupRegion | null {
  const center = cardCenter(node);
  return regions
    .filter((region) => frameContains(regionFrame(region), center.x, center.y))
    .sort((a, b) => {
      const fa = regionFrame(a);
      const fb = regionFrame(b);
      return fa.width * fa.height - fb.width * fb.height;
    })[0] ?? null;
}
