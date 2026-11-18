"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./CanvasMinimap.module.css";

export interface MinimapItem {
  id: string;
  kind: "card" | "note" | "group";
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MinimapView {
  /** Canvas-space rectangle currently on screen. */
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CanvasMinimapProps {
  items: MinimapItem[];
  /** Reads where the screen currently is on the canvas. Called from events, never during render. */
  getView: () => MinimapView | null;
  /** Calls back whenever the canvas pans or zooms. Returns an unsubscribe function. */
  subscribe: (listener: () => void) => () => void;
  /** Centre the screen on this canvas point. */
  onNavigate: (x: number, y: number) => void;
  /** Distance from the right edge of the canvas. */
  right: string;
}

const WIDTH = 180;
const HEIGHT = 120;
const MARGIN = 8;

interface Bounds { x: number; y: number; width: number; height: number }

function unionBounds(items: MinimapItem[], view: MinimapView | null): Bounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (x: number, y: number, w: number, h: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  };
  for (const item of items) add(item.x, item.y, item.width, item.height);
  if (view) add(view.x, view.y, view.width, view.height);
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, width: Math.max(maxX - minX, 1), height: Math.max(maxY - minY, 1) };
}

export function CanvasMinimap({ items, getView, subscribe, onNavigate, right }: CanvasMinimapProps) {
  const [view, setView] = useState<MinimapView | null>(null);
  // While the pointer is down the map keeps its scale, so the thing being dragged does not slide away.
  const [frozenBounds, setFrozenBounds] = useState<Bounds | null>(null);
  const dragging = frozenBounds !== null;

  const refresh = useCallback(() => setView(getView()), [getView]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Read the canvas position once the minimap mounts.
    refresh();
    const unsubscribe = subscribe(refresh);
    window.addEventListener("resize", refresh);
    return () => {
      unsubscribe();
      window.removeEventListener("resize", refresh);
    };
  }, [refresh, subscribe]);

  const bounds = frozenBounds ?? unionBounds(items, view);
  if (!bounds || !view) return null;

  const scale = Math.min((WIDTH - MARGIN * 2) / bounds.width, (HEIGHT - MARGIN * 2) / bounds.height);
  const offsetX = (WIDTH - bounds.width * scale) / 2 - bounds.x * scale;
  const offsetY = (HEIGHT - bounds.height * scale) / 2 - bounds.y * scale;

  function navigate(event: React.PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * WIDTH;
    const py = ((event.clientY - rect.top) / rect.height) * HEIGHT;
    onNavigate((px - offsetX) / scale, (py - offsetY) / scale);
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setFrozenBounds(bounds);
    navigate(event);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragging) return;
    navigate(event);
  }

  function handlePointerEnd(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragging) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    setFrozenBounds(null);
  }

  return (
    <div
      className={styles.minimap}
      data-canvas-ui="true"
      data-dragging={dragging ? "" : undefined}
      style={{ right }}
      role="group"
      tabIndex={0}
      aria-label="Canvas overview. Click or drag to move around, or use the arrow keys."
      onKeyDown={(event) => {
        const steps: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
        const step = steps[event.key];
        if (!step) return;
        event.preventDefault();
        // A quarter of the screen per press, a whole screen with Shift.
        const amount = event.shiftKey ? 1 : 0.25;
        onNavigate(
          view.x + view.width / 2 + step[0] * view.width * amount,
          view.y + view.height / 2 + step[1] * view.height * amount,
        );
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
    >
      <svg className={styles.svg} viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
        <g transform={`translate(${offsetX} ${offsetY}) scale(${scale})`}>
          {items.map((item) => (
            <rect
              key={item.id}
              className={item.kind === "group" ? styles.group : item.kind === "note" ? styles.note : styles.card}
              x={item.x}
              y={item.y}
              width={item.width}
              height={item.height}
              rx={item.kind === "group" ? 20 : 6}
            />
          ))}
          <rect className={styles.view} x={view.x} y={view.y} width={view.width} height={view.height} rx={4} />
        </g>
      </svg>
    </div>
  );
}
