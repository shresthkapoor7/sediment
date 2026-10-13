"use client";

import { ReactNode, useLayoutEffect, useRef } from "react";

/** Natural card sizes, with bounded previews adjusted to a shared column bottom. */
export function BalancedMasonry({ children, className, items }: { children: ReactNode; className: string; items: readonly unknown[] }) {
  const container = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const root = container.current;
    if (!root) return;
    let frame = 0;
    let disposed = false;
    let lastWidth = 0;

    function layout() {
      if (!root || disposed) return;
      const cards = Array.from(root.children) as HTMLElement[];
      const width = root.clientWidth;
      if (!cards.length || !width) {
        root.style.height = "";
        delete root.dataset.balanced;
        return;
      }
      const css = getComputedStyle(root);
      const availableColumns = Number(css.getPropertyValue("--column-count")) || 1;
      const count = Math.min(cards.length, availableColumns);
      const gap = parseFloat(css.columnGap) || 18;
      const cardWidth = (width - gap * (availableColumns - 1)) / availableColumns;
      lastWidth = width;
      root.dataset.balanced = "true";
      for (const card of cards) {
        card.style.width = `${cardWidth}px`;
        card.style.height = "auto";
      }
      // Batch writes before reads so each preview size needs only one layout pass.
      function measure(lines: number, image: number) {
        cards.forEach(card => {
          card.style.setProperty("--preview-lines", String(lines));
          card.style.setProperty("--image-height", `${image}px`);
        });
        return cards.map(card => card.getBoundingClientRect().height);
      }
      const minimum = measure(3, 120);
      const content = cards.map((card, index) => {
        const summary = card.querySelector<HTMLElement>("[data-preview]");
        const image = card.querySelector<HTMLImageElement>("figure img");
        return {
          fixed: minimum[index] - (summary?.getBoundingClientRect().height || 0) - (image?.getBoundingClientRect().height || 0),
          lineHeight: summary ? parseFloat(getComputedStyle(summary).lineHeight) : 1,
          hasImage: !!image,
        };
      });
      const preferred = measure(6, 180);
      const maximum = measure(9, 240);
      const columns = Array.from({ length: count }, () => ({ indices: [] as number[], height: 0 }));
      cards.forEach((_, index) => {
        const column = columns.reduce((shortest, candidate) => candidate.height < shortest.height ? candidate : shortest);
        column.indices.push(index);
        column.height += preferred[index] + gap;
      });
      const total = (indices: number[], sizes: number[]) => indices.reduce((sum, index) => sum + sizes[index], 0) + Math.max(0, indices.length - 1) * gap;
      const lower = Math.max(...columns.map(column => total(column.indices, minimum)));
      const upper = Math.min(...columns.map(column => total(column.indices, maximum)));
      const average = columns.reduce((sum, column) => sum + total(column.indices, preferred), 0) / count;
      const target = count === 1 ? total(columns[0].indices, preferred) : Math.max(lower, Math.min(average, upper));

      columns.forEach((column, columnIndex) => {
        const natural = total(column.indices, preferred);
        const grow = target >= natural;
        const bounds = grow ? maximum : minimum;
        const capacity = Math.abs(total(column.indices, bounds) - natural);
        const fraction = capacity ? Math.min(1, Math.abs(target - natural) / capacity) : 0;
        const sizes = column.indices.map(index => preferred[index] + (bounds[index] - preferred[index]) * fraction);
        // Very sparse metadata may have no preview to expand; share the small
        // remainder rather than leaving a single oversized final card.
        const remainder = (target - sizes.reduce((sum, height) => sum + height, 0) - (sizes.length - 1) * gap) / sizes.length;
        let top = 0;
        column.indices.forEach((index, position) => {
          const card = cards[index];
          const height = sizes[position] + remainder;
          card.style.height = `${height}px`;
          card.style.left = `${columnIndex * (cardWidth + gap)}px`;
          card.style.top = `${top}px`;
          const imageHeight = 180 + (grow ? 60 : -60) * fraction;
          card.style.setProperty("--image-height", `${imageHeight}px`);
          // Count actual available lines: short abstracts don't grow linearly
          // with the clamp, so interpolating line counts could clip the footer.
          const available = height - content[index].fixed - (content[index].hasImage ? imageHeight : 0);
          const lines = Math.max(3, Math.min(9, Math.floor(available / content[index].lineHeight + .001)));
          card.style.setProperty("--preview-lines", String(lines));
          top += height + gap;
        });
      });
      root.style.height = `${target}px`;
    }

    function schedule() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(layout);
    }
    layout();
    const observer = new ResizeObserver(() => {
      if (root.clientWidth !== lastWidth) schedule();
    });
    observer.observe(root);
    // Viewport breakpoints can change column count without changing max-width.
    window.addEventListener("resize", schedule);
    root.addEventListener("load", schedule, true);
    root.addEventListener("error", schedule, true);
    void document.fonts.ready.then(() => { if (!disposed) schedule(); });
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      root.removeEventListener("load", schedule, true);
      root.removeEventListener("error", schedule, true);
    };
  // Selection and bookmark controls rerender children without changing the papers.
  // Remeasuring then can trigger browser scroll anchoring during temporary sizes.
  }, [items]);

  return <div ref={container} className={className}>{children}</div>;
}
