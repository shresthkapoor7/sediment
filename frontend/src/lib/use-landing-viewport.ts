import { useEffect, useState } from "react";

// Tracks coarse landing-page breakpoints. Shared by the landing page shell and
// the (dynamically imported) demo scenes so both agree on compact/mobile layout.
export function useLandingViewport() {
  const [viewport, setViewport] = useState({ compact: false, mobile: false });

  useEffect(() => {
    const updateViewport = () => {
      const width = window.innerWidth;
      const compact = width <= 1024;
      const mobile = width <= 640;
      // Only allocate a new object (and re-render consumers) when a breakpoint
      // actually flips — most resize events don't cross one.
      setViewport((prev) =>
        prev.compact === compact && prev.mobile === mobile
          ? prev
          : { compact, mobile },
      );
    };

    updateViewport();
    window.addEventListener("resize", updateViewport);
    return () => window.removeEventListener("resize", updateViewport);
  }, []);

  return viewport;
}
