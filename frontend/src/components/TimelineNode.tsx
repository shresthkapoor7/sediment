"use client";

import { motion } from "framer-motion";
import { TimelineNode as TNode } from "@/lib/types";
import { NODE_DIMENSIONS } from "@/lib/dummy-data";

interface TimelineNodeProps {
  node: TNode;
  index: number;
  onClick: (id: number) => void;
  isActive: boolean;
  shouldAnimate: boolean;
}

export function TimelineNodeCard({
  node,
  index,
  onClick,
  isActive,
  shouldAnimate,
}: TimelineNodeProps) {
  const { width, height } = NODE_DIMENSIONS;

  return (
    <motion.g
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
      style={{ cursor: "pointer" }}
      onClick={() => onClick(node.id)}
    >
      <foreignObject
        x={node.x - 4}
        y={node.y - 4}
        width={width + 8}
        height={height + 8}
        style={{ overflow: "visible" }}
      >
        <div
          style={{
            width,
            height,
            margin: 4,
            background: "var(--node-bg)",
            border: `1.5px solid ${isActive ? "var(--accent)" : "var(--node-border)"}`,
            borderRadius: 12,
            padding: "12px 14px",
            display: "flex",
            flexDirection: "column",
            gap: 6,
            boxShadow: isActive
              ? "0 0 0 3px var(--accent-soft), var(--node-shadow)"
              : "var(--node-shadow)",
            transition: "border-color 0.2s, box-shadow 0.2s, transform 0.2s",
            overflow: "hidden",
            position: "relative",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.boxShadow = "var(--node-shadow-hover)";
            e.currentTarget.style.transform = "translateY(-2px)";
            e.currentTarget.style.borderColor = "var(--accent)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.boxShadow = isActive
              ? "0 0 0 3px var(--accent-soft), var(--node-shadow)"
              : "var(--node-shadow)";
            e.currentTarget.style.transform = "translateY(0)";
            e.currentTarget.style.borderColor = isActive
              ? "var(--accent)"
              : "var(--node-border)";
          }}
        >
          {/* Expanded indicator */}
          {node.expanded && (
            <div
              style={{
                position: "absolute",
                top: 8,
                right: 8,
                width: 6,
                height: 6,
                borderRadius: 3,
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
              fontSize: 11,
              fontWeight: 500,
              fontFamily: "'JetBrains Mono', monospace",
              padding: "2px 7px",
              borderRadius: 4,
              lineHeight: "16px",
              letterSpacing: "0.02em",
            }}
          >
            {node.paper.year}
          </span>

          {/* Title */}
          <p
            style={{
              fontSize: 13.5,
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
              fontSize: 11,
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
      </foreignObject>
    </motion.g>
  );
}
