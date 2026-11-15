"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { m } from "framer-motion";
import { TimelineNode as TNode, NodeBorderColor } from "@/lib/types";
import { NODE_BORDER_COLOR_OPTIONS, nodeBorderColorCss } from "@/lib/node-style";
import { NODE_DIMENSIONS } from "@/lib/layout-constants";
import styles from "./TimelineNode.module.css";

interface TimelineNodeProps {
  node: TNode;
  index: number;
  onClick: (id: number) => void;
  /** Called while the card is dragged, with its new canvas position. */
  onMove?: (id: number, x: number, y: number) => void;
  onMoveEnd?: (id: number) => void;
  /** Current canvas zoom, so a drag covers the same distance as the pointer. */
  getZoom?: () => number;
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
  /** Names of the clusters on the canvas, for the cluster menu. */
  groups?: string[];
  onSetGroup?: (id: number, group: string | null) => void;
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
  onMove,
  onMoveEnd,
  getZoom,
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
  groups = [],
  onSetGroup,
}: TimelineNodeProps) {
  const { width, height } = NODE_DIMENSIONS;
  const { paper } = node;
  const color = node.annotation?.borderColor ?? null;
  const deleteDisabled = isGraphActionDisabled || isLocked || isOnlyNode;
  const state = isActive || isSelected ? "active" : isHighlighted || isMentioned ? "marked" : undefined;
  const authors = authorLine(paper.authors);

  // Cluster menu: pick an existing cluster, start a new one, or leave the current one.
  const [groupMenuOpen, setGroupMenuOpen] = useState(false);
  const [newGroup, setNewGroup] = useState("");
  const groupMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!groupMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && groupMenuRef.current?.contains(event.target)) return;
      setGroupMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setGroupMenuOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [groupMenuOpen]);
  const chooseGroup = (group: string | null) => {
    onSetGroup?.(node.id, group);
    setGroupMenuOpen(false);
    setNewGroup("");
  };

  // Drag to move. A press that travels less than a few pixels is still a click.
  const dragRef = useRef<{ pointerId: number; clientX: number; clientY: number; x: number; y: number; moved: boolean } | null>(null);
  const draggedRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);
  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!onMove || event.button !== 0 || event.altKey || event.pointerType === "touch") return;
    if (event.target instanceof Element && event.target.closest("[data-canvas-ui='true']")) return;
    draggedRef.current = false;
    dragRef.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, x: node.x, y: node.y, moved: false };
  };
  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.clientX;
    const dy = event.clientY - drag.clientY;
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < 4) return;
      drag.moved = true;
      draggedRef.current = true;
      setIsDragging(true);
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // The pointer is already gone; the drag simply ends on the next pointer event.
      }
    }
    const zoom = getZoom?.() || 1;
    onMove?.(node.id, Math.round(drag.x + dx / zoom), Math.round(drag.y + dy / zoom));
  };
  const handlePointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (!drag.moved) return;
    setIsDragging(false);
    onMoveEnd?.(node.id);
  };

  return (
    <m.div
      className={styles.wrap}
      initial={shouldAnimate ? { opacity: 0, y: 12 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={shouldAnimate ? { duration: 0.5, delay: index * 0.06, ease: [0.16, 1, 0.3, 1] } : { duration: 0 }}
      style={{ left: node.x - 4, top: node.y - 4, width: width + 8, height: canEdit ? height + 54 : height + 8 }}
      data-dragging={isDragging ? "" : undefined}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onClick={() => {
        // The click that ends a drag is not a selection.
        if (draggedRef.current) {
          draggedRef.current = false;
          return;
        }
        onClick(node.id);
      }}
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
        {paper.summary && <p className={styles.summary}>{paper.summary}</p>}
        <p className={styles.authors}>{authors}</p>
      </div>

      {canEdit && (
        <div
          className={styles.bar}
          data-canvas-ui="true"
          data-show={isSelected || groupMenuOpen ? "" : undefined}
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
          {onSetGroup && (
            <div ref={groupMenuRef} className={styles.groupAnchor}>
              <button
                type="button"
                disabled={isGraphActionDisabled}
                onClick={() => setGroupMenuOpen((open) => !open)}
                aria-expanded={groupMenuOpen}
                title={node.group ? `Cluster: ${node.group}` : "Add to a cluster"}
              >
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2" y="2" width="5" height="5" rx="1.2" /><rect x="9" y="2" width="5" height="5" rx="1.2" /><rect x="2" y="9" width="5" height="5" rx="1.2" /><path d="M11.500 9.500v4M9.500 11.500h4" /></svg>
                Cluster
              </button>
              {groupMenuOpen && (
                <div className={styles.groupMenu} role="menu">
                  {groups.map((group) => {
                    const current = node.group?.trim().toLowerCase() === group.trim().toLowerCase();
                    return (
                      <button key={group} type="button" role="menuitemradio" aria-checked={current} onClick={() => chooseGroup(group)}>
                        <span>{group}</span>
                        {current && <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2.500 6.500 5 9l4.500-6" /></svg>}
                      </button>
                    );
                  })}
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (newGroup.trim()) chooseGroup(newGroup);
                    }}
                  >
                    <input
                      value={newGroup}
                      onChange={(event) => setNewGroup(event.target.value)}
                      onKeyDown={(event) => event.stopPropagation()}
                      maxLength={48}
                      placeholder="New cluster name"
                      aria-label="New cluster name"
                    />
                  </form>
                  {node.group && (
                    <button type="button" role="menuitem" className={styles.groupLeave} onClick={() => chooseGroup(null)}>
                      Remove from cluster
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
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
