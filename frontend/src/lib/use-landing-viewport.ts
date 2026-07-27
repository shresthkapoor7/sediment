import { useEffect, useState } from "react";

// Tracks coarse landing-page breakpoints. Shared by the landing page shell and
// the (dynamically imported) demo scenes so both agree on compact/mobile layout.
export function useLandingViewport() {
  const [viewport, setViewport] = useState({ compact: false, mobile: false });

  useEffect(() => {
    const updateViewport = () => {
      const width = window.innerWidth;
      setViewport({
        compact: width <= 1024,
        mobile: width <= 640,
      });
    };

    updateViewport();
    window.addEventListener("resize", updateViewport);
    return () => window.removeEventListener("resize", updateViewport);
  }, []);

  return viewport;
}
