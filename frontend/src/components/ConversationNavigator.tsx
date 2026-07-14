"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export interface ConversationNavigationItem {
  id: string;
  label: string;
}

interface ConversationNavigatorProps {
  items: ConversationNavigationItem[];
  onJump: (id: string) => void;
  activeId?: string | null;
  onActiveChange?: (id: string) => void;
  side: "left" | "right";
  label?: string;
}

export function ConversationNavigator({
  items,
  onJump,
  activeId,
  onActiveChange,
  side,
  label = "Jump through chat",
}: ConversationNavigatorProps) {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const closeTimerRef = useRef<number | null>(null);
  const visibleItems = useMemo(() => items.slice(-12), [items]);

  useEffect(() => () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
    }
  }, []);

  if (visibleItems.length < 2) return null;

  const barCount = 7;
  const selectedIndex = Math.max(0, visibleItems.findIndex((item) => item.id === activeId));
  const selectedBarIndex = Math.round(
    (selectedIndex / Math.max(visibleItems.length - 1, 1)) * (barCount - 1),
  );
  const isVisible = hovered || open;

  const cancelClose = () => {
    if (closeTimerRef.current === null) return;
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  };

  const scheduleClose = () => {
    setHovered(false);
    if (!open) return;
    cancelClose();
    closeTimerRef.current = window.setTimeout(() => {
      setOpen(false);
      closeTimerRef.current = null;
    }, 220);
  };

  return (
    <div
      data-canvas-ui="true"
      onMouseEnter={() => {
        cancelClose();
        setHovered(true);
      }}
      onMouseLeave={scheduleClose}
      style={{
        position: "absolute",
        top: "50%",
        [side]: "0.125rem",
        transform: "translateY(-50%)",
        zIndex: 10,
        width: "2rem",
        height: "9rem",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <button
        type="button"
        onClick={() => {
          cancelClose();
          setHovered(true);
          setOpen((current) => !current);
        }}
        aria-label={label}
        aria-expanded={open}
        title={label}
        style={{
          width: "1.875rem",
          height: "2rem",
          padding: "0.1875rem 0",
          border: "none",
          background: "transparent",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: "pointer",
          opacity: isVisible ? 1 : 0,
          transition: "opacity 0.16s ease",
        }}
      >
        {Array.from({ length: barCount }, (_, index) => (
          <span
            key={index}
            style={{
              width: "1.6rem",
              height: "0.1875rem",
              borderRadius: "999px",
              background: index === selectedBarIndex ? "var(--text-primary)" : "var(--border-hover)",
              transition: "background 0.15s, width 0.15s",
            }}
          />
        ))}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Chat navigation"
          onMouseEnter={() => {
            cancelClose();
            setHovered(true);
          }}
          onMouseLeave={scheduleClose}
          style={{
            position: "absolute",
            top: "50%",
            [side]: "calc(100% + 0.5rem)",
            transform: "translateY(-50%)",
            zIndex: 40,
            width: "min(24rem, calc(100vw - 2rem))",
            maxHeight: "min(30rem, calc(100vh - 5rem))",
            overflowY: "auto",
            padding: "0.5rem",
            borderRadius: "1rem",
            border: "0.0625rem solid var(--border)",
            background: "var(--bg-secondary)",
            boxShadow: "0 1rem 2.5rem rgba(0,0,0,0.28)",
          }}
        >
          {visibleItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onActiveChange?.(item.id);
                onJump(item.id);
                setOpen(false);
                setHovered(false);
                cancelClose();
              }}
              title={item.label}
              style={{
                display: "block",
                width: "100%",
                padding: "0.625rem 0.75rem",
                border: "none",
                borderRadius: "0.75rem",
                background: item.id === activeId ? "var(--bg-tertiary)" : "transparent",
                color: "var(--text-primary)",
                fontFamily: "'DM Sans', sans-serif",
                fontSize: "0.8125rem",
                lineHeight: 1.35,
                textAlign: "left",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                cursor: "pointer",
              }}
              onMouseEnter={(event) => {
                event.currentTarget.style.background = "var(--bg-tertiary)";
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.background = item.id === activeId ? "var(--bg-tertiary)" : "transparent";
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
