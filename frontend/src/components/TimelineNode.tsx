"use client";

import type { CSSProperties } from "react";
import { m } from "framer-motion";
import { TimelineNode as TNode, NodeBorderColor } from "@/lib/types";
import { NODE_BORDER_COLOR_OPTIONS, nodeBorderColorCss } from "@/lib/node-style";
import { NODE_DIMENSIONS } from "@/lib/layout-constants";
import styles from "./TimelineNode.module.css";

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
  isGraphActionDisabled?: boolean;
  isLocked?: boolean;
  isOnlyNode?: boolean;
  onSetBorderColor?: (id: number, borderColor: NodeBorderColor | null) => void;
  onAddNote?: (id: number) => void;
  onAddSpecialNote?: (id: number) => void;
  onDeleteNode?: (id: number) => void;
}

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

function authorLine(authors?: string[]) {
  if (!authors?.length) return "";
  const shown = authors.slice(0, 2).join(", ");
  return authors.length > 2 ? `${shown} +${authors.length - 2}` : shown;
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
  isGraphActionDisabled = false,
  isLocked = false,
  isOnlyNode = false,
  onSetBorderColor,
  onAddNote,
  onAddSpecialNote,
  onDeleteNode,
}: TimelineNodeProps) {
  const { width, height } = NODE_DIMENSIONS;
  const { paper } = node;
  const color = node.annotation?.borderColor ?? null;
  const deleteDisabled = isGraphActionDisabled || isLocked || isOnlyNode;
  const state = isActive || isSelected ? "active" : isHighlighted || isMentioned ? "marked" : undefined;
  const authors = authorLine(paper.authors) || paper.summary;

  return (
    <m.div
      className={styles.wrap}
      initial={shouldAnimate ? { opacity: 0, y: 12 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={shouldAnimate ? { duration: 0.5, delay: index * 0.06, ease: [0.16, 1, 0.3, 1] } : { duration: 0 }}
      style={{ left: node.x - 4, top: node.y - 4, width: width + 8, height: canEdit ? height + 52 : height + 8 }}
      onClick={() => onClick(node.id)}
      onMouseEnter={(event) => onHoverStart?.(node.id, event.currentTarget.getBoundingClientRect())}
      onMouseLeave={() => onHoverEnd?.(node.id)}
    >
      <div
        className={styles.card}
        data-state={state}
        data-tint={color ? "" : undefined}
        style={{ width, height, ...(color ? ({ "--card-stroke": nodeBorderColorCss(color) } as CSSProperties) : null) }}
      >
        <div className={styles.meta}>
          <span className={styles.year}>{paper.year}</span>
          {paper.type && paper.type !== "article" && <span>{paper.type.replace(/-/g, " ")}</span>}
          <span className={styles.cites}>
            {typeof paper.citedByCount === "number" && paper.citedByCount > 0 && <>{compact.format(paper.citedByCount)} cited</>}
            {node.expanded && <span className={styles.dot} title="Expanded" />}
          </span>
        </div>
        <p className={styles.title} title={paper.title}>{paper.title}</p>
        <p className={styles.authors}>{authors}</p>
      </div>

      {canEdit && (
        <div
          className={styles.bar}
          data-canvas-ui="true"
          data-show={isSelected ? "" : undefined}
          style={{ top: height + 12 }}
          onClick={(event) => event.stopPropagation()}
        >
          <button type="button" disabled={isGraphActionDisabled} onClick={() => onAddNote?.(node.id)} title="Add a note linked to this paper">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 2.5h10v7L9.5 13.5H3zM13 9.5H9.5v4" /></svg>
            Note
          </button>
          <button type="button" disabled={isGraphActionDisabled} onClick={() => onAddSpecialNote?.(node.id)} title="Attach a file" aria-label="Attach a file">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M13 7.5 8 12.5a3 3 0 0 1-4.2-4.3l5.4-5.3a2 2 0 0 1 2.8 2.8L6.7 11a1 1 0 0 1-1.4-1.4L10 5" /></svg>
          </button>
          <span className={styles.sep} />
          <div className={styles.swatches} role="group" aria-label="Card colour">
            {NODE_BORDER_COLOR_OPTIONS.map((option) => {
              const selected = color === option.key;
              return <button
                key={option.key}
                type="button"
                className={styles.swatch}
                aria-pressed={selected}
                aria-label={selected ? `Clear ${option.label.toLowerCase()}` : option.label}
                title={selected ? "Clear colour" : option.label}
                disabled={isGraphActionDisabled}
                style={{ background: option.css }}
                onClick={() => onSetBorderColor?.(node.id, selected ? null : option.key)}
              />;
            })}
          </div>
          <span className={styles.sep} />
          <button type="button" className={styles.danger} disabled={deleteDisabled} onClick={() => onDeleteNode?.(node.id)} title={isLocked ? "The seed paper can't be removed" : "Remove from canvas"} aria-label="Remove from canvas">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.5 8.5h6l.5-8.5" /></svg>
          </button>
        </div>
      )}
    </m.div>
  );
}
