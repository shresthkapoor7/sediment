"use client";

import { useEffect, useRef } from "react";
import { LANDING_ASCII } from "@/lib/landing-ascii";

/**
 * Home-page backdrop: a faint ASCII ridge whose glyphs brighten in a soft circle around the
 * pointer. Fills its positioned parent; the look lives in `.landing-ascii` in globals.css.
 */
export function AsciiBackdrop() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let frame = 0;
    let x = 0;
    let y = 0;

    const onMove = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      x = event.clientX;
      y = event.clientY;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const rect = el.getBoundingClientRect();
        el.style.setProperty("--mx", `${x - rect.left}px`);
        el.style.setProperty("--my", `${y - rect.top}px`);
        el.style.setProperty("--glow", "1");
      });
    };
    const onLeave = () => el.style.setProperty("--glow", "0");

    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return (
    <div ref={ref} className="landing-ascii" aria-hidden="true">
      <pre className="landing-ascii-art">{LANDING_ASCII}</pre>
      <div className="landing-ascii-lit">
        <pre className="landing-ascii-art">{LANDING_ASCII}</pre>
      </div>
    </div>
  );
}
