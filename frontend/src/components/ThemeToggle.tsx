"use client";

import { useTheme } from "./ThemeProvider";

export function ThemeToggle({
  showLabel = false,
  fullWidth = false,
  className,
}: {
  showLabel?: boolean;
  fullWidth?: boolean;
  className?: string;
}) {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";

  return (
    <button
      className={className}
      onClick={toggle}
      aria-label="Toggle theme"
      style={{
        background: "none",
        border: fullWidth ? "none" : "0.0625rem solid var(--border)",
        borderRadius: fullWidth ? "0.375rem" : "0.4375rem",
        width: fullWidth ? "100%" : showLabel ? "auto" : "2rem",
        height: "2rem",
        display: "flex",
        alignItems: "center",
        justifyContent: fullWidth ? "flex-start" : "center",
        gap: showLabel ? "0.625rem" : 0,
        padding: fullWidth ? "0 0.5rem" : showLabel ? "0 0.625rem" : 0,
        cursor: "pointer",
        color: fullWidth ? "var(--text-primary)" : "var(--text-secondary)",
        fontFamily: "'DM Sans', sans-serif",
        fontSize: "0.75rem",
        fontWeight: 500,
        textAlign: "left",
        transition: "border-color 0.15s, color 0.15s",
      }}
      onMouseEnter={(e) => {
        if (fullWidth) return;
        e.currentTarget.style.borderColor = "var(--accent)";
        e.currentTarget.style.color = "var(--accent)";
      }}
      onMouseLeave={(e) => {
        if (!fullWidth) e.currentTarget.style.borderColor = "var(--border)";
        e.currentTarget.style.color = fullWidth ? "var(--text-primary)" : "var(--text-secondary)";
      }}
    >
      {isDark ? (
        <svg width={fullWidth ? "14" : "16"} height={fullWidth ? "14" : "16"} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" style={fullWidth ? { color: "var(--text-tertiary)" } : undefined}>
          <path d="M13.5 8.5A5.5 5.5 0 0 1 6 2a6 6 0 1 0 7.5 6.5z" fill="currentColor" stroke="none" />
        </svg>
      ) : (
        <svg width={fullWidth ? "14" : "16"} height={fullWidth ? "14" : "16"} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" style={fullWidth ? { color: "var(--text-tertiary)" } : undefined}>
          <circle cx="8" cy="8" r="3.5" fill="currentColor" stroke="none" />
          <path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3.1 3.1l1.1 1.1M11.8 11.8l1.1 1.1M12.9 3.1l-1.1 1.1M4.2 11.8l-1.1 1.1" />
        </svg>
      )}
      {showLabel && <span className="app-header-action-label">Theme</span>}
    </button>
  );
}
