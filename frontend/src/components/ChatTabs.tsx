"use client";

import { useEffect, useRef } from "react";
import styles from "./ChatTabs.module.css";

export interface ChatTabItem {
  id: string;
  title: string | null;
}

interface ChatTabsProps {
  tabs: ChatTabItem[];
  activeId: string | null;
  /** Chats the agent is still answering in. */
  busyIds: Set<string>;
  canAdd: boolean;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onClose: (id: string) => void;
  onClosePanel: () => void;
}

export function ChatTabs({ tabs, activeId, busyIds, canAdd, onSelect, onAdd, onClose, onClosePanel }: ChatTabsProps) {
  const activeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeId, tabs.length]);

  // With one chat there is nothing to close; the last tab always stays.
  const closable = tabs.length > 1;

  return (
    <div className={styles.strip}>
      <div className={styles.tabs} role="tablist" aria-label="Chats">
        {tabs.map((tab) => {
          const active = tab.id === activeId;
          const title = tab.title?.trim() || "New chat";
          return (
            <div
              key={tab.id}
              ref={active ? activeRef : undefined}
              className={styles.tab}
              data-active={active ? "" : undefined}
              data-closable={closable ? "" : undefined}
            >
              {busyIds.has(tab.id) && <span className={styles.busy} aria-label="Working" />}
              <button
                type="button"
                role="tab"
                aria-selected={active}
                className={styles.select}
                onClick={() => onSelect(tab.id)}
                title={title}
              >
                {title}
              </button>
              {closable && (
                <button
                  type="button"
                  className={styles.close}
                  onClick={() => onClose(tab.id)}
                  disabled={busyIds.has(tab.id)}
                  aria-label={`Close chat: ${title}`}
                  title="Close chat"
                >
                  <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                    <path d="M2 2l8 8M10 2l-8 8" />
                  </svg>
                </button>
              )}
            </div>
          );
        })}
      </div>
      <button type="button" className={styles.action} onClick={onAdd} disabled={!canAdd} aria-label="New chat" title="New chat">
        <svg width="13" height="13" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
          <path d="M6 1.5v9M1.5 6h9" />
        </svg>
      </button>
      <button type="button" className={styles.action} onClick={onClosePanel} aria-label="Close agent" title="Close agent">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <path d="M3 3l10 10M13 3L3 13" />
        </svg>
      </button>
    </div>
  );
}
