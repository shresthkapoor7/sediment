"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { LazyMotion, domAnimation } from "framer-motion";

type Theme = "light" | "dark";

interface ThemeContextValue {
  theme: Theme;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "dark",
  toggle: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

/**
 * Provides theme state and controls to descendant components.
 *
 * @param children - Content rendered within the theme provider
 * @returns The theme context provider containing the rendered children
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>("dark");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("sediment-theme");
    if (stored === "light" || stored === "dark") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Hydrate the persisted theme preference.
      setTheme(stored);
    } else if (window.matchMedia("(prefers-color-scheme: light)").matches) {
      setTheme("light");
    }
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted) {
      document.documentElement.setAttribute("data-theme", theme);
      localStorage.setItem("sediment-theme", theme);
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
        <div style={{ visibility: mounted ? "visible" : "hidden" }}>
          {children}
        </div>
      </LazyMotion>
    </ThemeContext.Provider>
  );
}
