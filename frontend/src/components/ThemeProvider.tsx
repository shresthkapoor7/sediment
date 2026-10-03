"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { LazyMotion, domAnimation } from "framer-motion";

type Theme = "light" | "dark";

interface ThemeContextValue {
  theme: Theme;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "light",
  toggle: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    let stored: string | null = null;
    try { stored = localStorage.getItem("sediment-theme"); } catch { /* Use the default theme when storage is blocked. */ }
    if (stored === "light" || stored === "dark") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Hydrate the persisted theme preference.
      setTheme(stored);
    }
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted) {
      document.documentElement.setAttribute("data-theme", theme);
      try { localStorage.setItem("sediment-theme", theme); } catch { /* Theme changes still work in memory. */ }
    }
  }, [theme, mounted]);

  const toggle = useCallback(() => {
    setTheme((t) => (t === "dark" ? "light" : "dark"));
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggle }}>
      {/* Lazy-load only DOM animation features (no layout/drag used) so the full
          framer-motion feature bundle stays out of the initial JS. */}
      <LazyMotion features={domAnimation} strict>
        {children}
      </LazyMotion>
    </ThemeContext.Provider>
  );
}
