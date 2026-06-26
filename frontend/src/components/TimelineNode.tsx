"use client";

import { useState } from "react";
import type { CSSProperties } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { TimelineNode as TNode, NodeBorderColor } from "@/lib/types";
import { NODE_BORDER_COLOR_OPTIONS, nodeBorderColorCss } from "@/lib/node-style";
import { NODE_DIMENSIONS } from "@/lib/dummy-data";

interface TimelineNodeProps {
  node: TNode;
  index: number;
  onClick: (id: number) => void;
  onHoverStart?: (id: number, rect: DOMRect) => void;
  onHoverEnd?: (id: number) => void;
  isActive: boolean;
  isHighlighted?: boolean;
  isMentioned?: boolean;
  isSelected?: boolean;
  shouldAnimate: boolean;
  canEdit?: boolean;
  isEditMenuOpen?: boolean;
  isGraphActionDisabled?: boolean;
  isLocked?: boolean;
  isOnlyNode?: boolean;
  onEditMenuToggle?: (id: number) => void;
  onSetBorderColor?: (id: number, borderColor: NodeBorderColor | null) => void;
  onAddNote?: (id: number) => void;
  onDeleteNode?: (id: number) => void;
}

export function TimelineNodeCard({
  node,
  index,
  onClick,
  onHoverStart,
  onHoverEnd,
  isActive,
  isHighlighted = false,
  isMentioned = false,
  isSelected = false,
  shouldAnimate,
  canEdit = false,
  isEditMenuOpen = false,
  isGraphActionDisabled = false,
  isLocked = false,
  isOnlyNode = false,
  onEditMenuToggle,
  onSetBorderColor,
  onAddNote,
  onDeleteNode,
}: TimelineNodeProps) {
  const [isHovered, setIsHovered] = useState(false);
  const { width, height } = NODE_DIMENSIONS;
  const annotationColor = node.annotation?.borderColor ? nodeBorderColorCss(node.annotation.borderColor) : null;
  const showEditButton = canEdit && (isHovered || isEditMenuOpen || isSelected);
  const deleteDisabled = isGraphActionDisabled || isLocked || isOnlyNode;
  const getBorderColor = (active: boolean, highlighted: boolean, mentioned: boolean) =>
    active || highlighted || mentioned ? "var(--accent)" : annotationColor ?? "var(--node-border)";
  const getBoxShadow = (active: boolean, highlighted: boolean, mentioned: boolean) =>
    active
      ? "0 0 0 0.1875rem var(--accent-soft), var(--node-shadow)"
      : highlighted
        ? "0 0 0 0.1875rem var(--accent-soft), 0 0 1rem var(--accent-glow), var(--node-shadow)"
        : mentioned
          ? "0 0 0 0.125rem var(--accent-soft), 0 0 1.125rem var(--accent-glow), var(--node-shadow)"
        : annotationColor
          ? `0 0 0 0.15625rem color-mix(in srgb, ${annotationColor} 28%, transparent), var(--node-shadow)`
        : "var(--node-shadow)";
  const getHoverBoxShadow = () => "var(--node-shadow-hover)";
  const borderColor = getBorderColor(isActive, isHighlighted, isMentioned);
  const boxShadow = getBoxShadow(isActive, isHighlighted, isMentioned);

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
        height: canEdit ? height + 52 : height + 8,
        cursor: "pointer",
        touchAction: "none",
      }}
      onClick={() => onClick(node.id)}
      onMouseEnter={(e) => {
        setIsHovered(true);
        onHoverStart?.(node.id, e.currentTarget.getBoundingClientRect());
      }}
      onMouseLeave={() => {
        setIsHovered(false);
        onHoverEnd?.(node.id);
      }}
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
          e.currentTarget.style.boxShadow = getBoxShadow(isActive, isHighlighted, isMentioned);
          e.currentTarget.style.transform = "translateY(0)";
          e.currentTarget.style.borderColor = getBorderColor(isActive, isHighlighted, isMentioned);
        }}
      >
        {isMentioned && (
          <motion.div
            aria-hidden="true"
            initial={{ opacity: 0.25 }}
            animate={{ opacity: [0.28, 0.75, 0.28] }}
            transition={{ duration: 1.45, repeat: Infinity, ease: "easeInOut" }}
            style={{
              position: "absolute",
              inset: "-0.0625rem",
              borderRadius: "0.75rem",
              border: "0.09375rem solid var(--accent)",
              boxShadow: "0 0 1.25rem var(--accent-glow)",
              pointerEvents: "none",
            }}
          />
        )}

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

      {canEdit && (
        <motion.button
          type="button"
          aria-label="Edit node"
          title="Edit node"
          initial={false}
          animate={{ opacity: showEditButton ? 1 : 0, scale: showEditButton ? 1 : 0.92 }}
          transition={{ duration: 0.14 }}
          onClick={(event) => {
            event.stopPropagation();
            onEditMenuToggle?.(node.id);
          }}
          style={{
            position: "absolute",
            top: height + 12,
            left: "calc(50% - 0.8125rem)",
            zIndex: 18,
            width: "1.625rem",
            height: "1.625rem",
            borderRadius: "999px",
            border: `0.0625rem solid ${isEditMenuOpen ? "var(--accent)" : "var(--border)"}`,
            background: isEditMenuOpen ? "var(--accent-soft)" : "color-mix(in srgb, var(--bg-primary) 84%, transparent)",
            color: isEditMenuOpen ? "var(--accent)" : "var(--text-secondary)",
            boxShadow: "0 0.5rem 1rem rgba(0,0,0,0.24)",
            backdropFilter: "blur(10px)",
            cursor: "pointer",
            pointerEvents: showEditButton ? "auto" : "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M10.8 2.2 13.8 5.2 6.1 12.9l-3.4.7.7-3.4 7.4-8Z" />
            <path d="M9.8 3.2l3 3" />
          </svg>
        </motion.button>
      )}

      <AnimatePresence>
        {canEdit && isEditMenuOpen && (
          <motion.div
            data-canvas-ui="true"
            initial={{ opacity: 0, scale: 0.94, y: 4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 4 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            onClick={(event) => event.stopPropagation()}
            style={{
              position: "absolute",
              top: height + 44,
              left: "calc(50% - 5.375rem)",
              zIndex: 20,
              width: "10.75rem",
              padding: "0.625rem",
              borderRadius: "1rem",
              border: "0.0625rem solid var(--border)",
              background: "color-mix(in srgb, var(--bg-primary) 92%, transparent)",
              boxShadow: "0 1rem 2.5rem rgba(0,0,0,0.28)",
              backdropFilter: "blur(18px)",
              cursor: "default",
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(6, 1.25rem)",
                gap: "0.35rem",
                marginBottom: "0.625rem",
              }}
            >
              {NODE_BORDER_COLOR_OPTIONS.map((color) => {
                const selected = node.annotation?.borderColor === color.key;
                return (
                  <button
                    key={color.key}
                    type="button"
                    title={`Set ${color.label.toLowerCase()} border`}
                    aria-label={`Set ${color.label.toLowerCase()} border`}
                    disabled={isGraphActionDisabled}
                    onClick={() => onSetBorderColor?.(node.id, color.key)}
                    style={{
                      width: "1.25rem",
                      height: "1.25rem",
                      borderRadius: "999px",
                      border: `0.125rem solid ${selected ? "var(--text-primary)" : "var(--border)"}`,
                      background: color.css,
                      cursor: isGraphActionDisabled ? "default" : "pointer",
                      opacity: isGraphActionDisabled ? 0.5 : 1,
                      boxShadow: selected ? `0 0 0 0.1875rem color-mix(in srgb, ${color.css} 28%, transparent)` : "none",
                    }}
                  />
                );
              })}
            </div>

            <div style={{ display: "grid", gap: "0.375rem" }}>
              <button
                type="button"
                disabled={isGraphActionDisabled || !node.annotation?.borderColor}
                onClick={() => onSetBorderColor?.(node.id, null)}
                style={menuButtonStyle(isGraphActionDisabled || !node.annotation?.borderColor)}
              >
                Clear border
              </button>
              <button
                type="button"
                disabled={isGraphActionDisabled}
                onClick={() => onAddNote?.(node.id)}
                style={menuButtonStyle(isGraphActionDisabled)}
              >
                Add note
              </button>
              <button
                type="button"
                disabled={deleteDisabled}
                onClick={() => onDeleteNode?.(node.id)}
                title={isLocked ? "Seed paper cannot be removed" : "Remove node"}
                style={{
                  ...menuButtonStyle(deleteDisabled),
                  color: deleteDisabled ? "var(--text-tertiary)" : "#f28b7c",
                }}
              >
                Delete node
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function menuButtonStyle(disabled: boolean): CSSProperties {
  return {
    height: "1.9rem",
    borderRadius: "0.625rem",
    border: "0.0625rem solid var(--border)",
    background: "var(--bg-secondary)",
    color: disabled ? "var(--text-tertiary)" : "var(--text-secondary)",
    cursor: disabled ? "default" : "pointer",
    fontSize: "0.625rem",
    fontWeight: 600,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    fontFamily: "'JetBrains Mono', monospace",
  };
}
