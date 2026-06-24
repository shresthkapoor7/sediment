"use client";

import { motion } from "framer-motion";
import { NodeBorderColor, TimelineNode } from "@/lib/types";
import { NODE_DIMENSIONS } from "@/lib/dummy-data";
import { nodeBorderColorCss } from "@/lib/node-style";

interface TimelineEdgeProps {
  from: TimelineNode;
  to: TimelineNode;
  index: number;
  isActive: boolean;
  isCrossLane?: boolean;
  isInferred?: boolean;
  annotationColor?: NodeBorderColor | null;
}

export function TimelineEdgeLine({
  from,
  to,
  index,
  isActive,
  isCrossLane = false,
  isInferred = false,
  annotationColor = null,
}: TimelineEdgeProps) {
  const { width, height } = NODE_DIMENSIONS;

  const y1 = from.y + height / 2;
  const y2 = to.y + height / 2;

  // Dock to outer borders: right→left when target is to the right, left→right when reversed
  const reversed = to.x < from.x;
  const x1 = reversed ? from.x : from.x + width;
  const x2 = reversed ? to.x + width + 2 : to.x - 2;

  const midX = (x1 + x2) / 2;
  const path = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;

  const colored = Boolean(annotationColor && !isActive);
  const markerId = isActive
    ? "arrow-active"
    : colored
      ? `arrow-colored-${annotationColor}`
      : isInferred || isCrossLane
        ? "arrow-cross"
        : "arrow-default";
  const strokeDasharray = isInferred ? "6 4" : isCrossLane ? "4 3" : undefined;
  const baseOpacity = isActive ? 1 : colored ? 0.88 : isInferred ? 0.42 : isCrossLane ? 0.5 : 0.7;
  const stroke = isActive
    ? "var(--edge-color-active)"
    : annotationColor
      ? nodeBorderColorCss(annotationColor)
      : "var(--edge-color)";

  return (
    <g>
      {/* Glow layer for active edges */}
      {isActive && (
        <motion.path
          d={path}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={6}
          strokeLinecap="round"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 0.15 }}
          transition={{
            pathLength: {
              duration: 0.6,
              delay: index * 0.08 + 0.2,
              ease: [0.16, 1, 0.3, 1],
            },
            opacity: { duration: 0.3, delay: index * 0.08 + 0.1 },
          }}
        />
      )}
      <motion.path
        d={path}
        fill="none"
        stroke={stroke}
        strokeWidth={isActive || colored ? 2 : 1.5}
        strokeLinecap="round"
        strokeDasharray={strokeDasharray}
        markerEnd={`url(#${markerId})`}
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: baseOpacity }}
        transition={{
          pathLength: {
            duration: 0.6,
            delay: index * 0.08 + 0.2,
            ease: [0.16, 1, 0.3, 1],
          },
          opacity: {
            duration: 0.3,
            delay: index * 0.08 + 0.1,
          },
        }}
      />
    </g>
  );
}
