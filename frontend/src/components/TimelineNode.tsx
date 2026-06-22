"use client";

import { motion } from "framer-motion";
import { TimelineNode as TNode } from "@/lib/types";
import { NODE_DIMENSIONS } from "@/lib/dummy-data";

interface TimelineNodeProps {
  node: TNode;
  index: number;
  onClick: (id: number) => void;
  onHoverStart?: (id: number, rect: DOMRect) => void;
  onHoverEnd?: (id: number) => void;
  isActive: boolean;
  isHighlighted?: boolean;
  shouldAnimate: boolean;
}

export function TimelineNodeCard({
  node,
  index,
  onClick,
  onHoverStart,
  onHoverEnd,
  isActive,
  isHighlighted = false,
  shouldAnimate,
}: TimelineNodeProps) {
  const { width, height } = NODE_DIMENSIONS;
  const getBorderColor = (active: boolean, highlighted: boolean) =>
    active || highlighted ? "var(--accent)" : "var(--node-border)";
  const getBoxShadow = (active: boolean, highlighted: boolean) =>
    active
      ? "0 0 0 0.1875rem var(--accent-soft), var(--node-shadow)"
      : highlighted
        ? "0 0 0 0.1875rem var(--accent-soft), 0 0 1rem var(--accent-glow), var(--node-shadow)"
        : "var(--node-shadow)";
  const getHoverBoxShadow = () => "var(--node-shadow-hover)";
  const borderColor = getBorderColor(isActive, isHighlighted);
  const boxShadow = getBoxShadow(isActive, isHighlighted);

  return (
    <motion.div
      initial={shouldAnimate ? { opacity: 0, y: 12 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={
        shouldAnimate
          ? {
              duration: 0.5,
              delay: index * 0.06,
              ease: [0.16, 1, 0.3, 1],
            }
          : { duration: 0 }
      }
      style={{
        position: "absolute",
        left: node.x - 4,
        top: node.y - 4,
        width: width + 8,
        height: height + 8,
        cursor: "pointer",
        touchAction: "none",
      }}
      onClick={() => onClick(node.id)}
      onMouseEnter={(e) => onHoverStart?.(node.id, e.currentTarget.getBoundingClientRect())}
      onMouseLeave={() => onHoverEnd?.(node.id)}
    >
      <div
        style={{
          width,
          height,
          margin: 4,
          background: "var(--node-bg)",
          border: `0.09375rem solid ${borderColor}`,
          borderRadius: "0.75rem",
          padding: "0.75rem 0.875rem",
          display: "flex",
          flexDirection: "column",
          gap: "0.375rem",
          boxShadow,
          transition: "border-color 0.2s, box-shadow 0.2s, transform 0.2s",
          overflow: "hidden",
          position: "relative",
          userSelect: "none",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.boxShadow = getHoverBoxShadow();
          e.currentTarget.style.transform = "translateY(-0.125rem)";
          e.currentTarget.style.borderColor = "var(--accent)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.boxShadow = getBoxShadow(isActive, isHighlighted);
          e.currentTarget.style.transform = "translateY(0)";
          e.currentTarget.style.borderColor = getBorderColor(isActive, isHighlighted);
        }}
      >
        {/* Expanded indicator */}
        {node.expanded && (
          <div
            style={{
              position: "absolute",
              top: "0.5rem",
              right: "0.5rem",
              width: "0.375rem",
              height: "0.375rem",
              borderRadius: "0.1875rem",
              background: "var(--accent)",
              opacity: 0.6,
            }}
          />
        )}

        {/* Year badge */}
        <span
          style={{
            alignSelf: "flex-start",
            background: "var(--accent-soft)",
            color: "var(--accent)",
            fontSize: "0.6875rem",
            fontWeight: 500,
            fontFamily: "'JetBrains Mono', monospace",
            padding: "0.125rem 0.4375rem",
            borderRadius: "0.25rem",
            lineHeight: "1rem",
            letterSpacing: "0.02em",
          }}
        >
          {node.paper.year}
        </span>

        {/* Title */}
        <p
          style={{
            fontSize: "0.84375rem",
            fontWeight: 600,
            color: "var(--text-primary)",
            lineHeight: 1.3,
            letterSpacing: "-0.015em",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontFamily: "'DM Sans', sans-serif",
          }}
        >
          {node.paper.title}
        </p>

        {/* Summary */}
        <p
          style={{
            fontSize: "0.6875rem",
            color: "var(--text-tertiary)",
            lineHeight: 1.4,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontFamily: "'DM Sans', sans-serif",
          }}
        >
          {node.paper.summary}
        </p>
      </div>
    </motion.div>
  );
}
