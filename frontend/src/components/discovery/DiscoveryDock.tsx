"use client";

import { PageHeader } from "@/components/PageHeader";
import styles from "./discovery.module.css";

interface DiscoveryDockProps {
  chatOpen: boolean;
  onToggleChat: () => void;
}

export function DiscoveryDock({ chatOpen, onToggleChat }: DiscoveryDockProps) {
  return <>
    <PageHeader title="Discovery" />
    <button className={`${styles.chatToggle} ${styles.mapChatToggle}`} onClick={onToggleChat} aria-label={chatOpen ? "Close sidebar" : "Open sidebar"} aria-pressed={chatOpen}>
      <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><rect x="3" y="3" width="14" height="14" rx="2" /><path d="M8 3v14" /></svg>
      <span>Ask about this map</span>
    </button>
  </>;
}
