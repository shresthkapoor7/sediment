"use client";

import styles from "@/components/discovery/discovery.module.css";
import { useState } from "react";
import { DiscoveryCanvas } from "@/components/discovery/DiscoveryCanvas";
import { DiscoveryDock } from "@/components/discovery/DiscoveryDock";
import { DiscoveryChat } from "@/components/discovery/DiscoveryChat";
import { SAMPLE_DISCOVERY_GRAPH } from "@/lib/discovery";

/* /discovery — schema-driven concept → sub-fields → papers map, drawn as a
   feed-forward neural net. Data comes from a DiscoveryGraph (see lib/discovery),
   so the backend/Claude can produce these directly. Dummy content for now. */

export default function DiscoveryPage() {
  const graph = SAMPLE_DISCOVERY_GRAPH;

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [chatOpen, setChatOpen] = useState(false);

  const toggleTopic = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const clearSelection = () => setSelected(new Set());

  return (
    <div
      className={`canvas-shell ${styles.page}`}
      style={{ position: "relative", width: "100vw", height: "100dvh", overflow: "hidden", background: "var(--bg-canvas)" }}
    >
      <DiscoveryDock
        chatOpen={chatOpen}
        onToggleChat={() => setChatOpen((v) => !v)}
      />
      <div className={styles.workspace}>
      <DiscoveryCanvas
        graph={graph}
        selected={selected}
        onToggleTopic={toggleTopic}
        onClearSelection={clearSelection}
      />
      </div>
      <DiscoveryChat open={chatOpen} onClose={() => setChatOpen(false)} graph={graph} />
    </div>
  );
}
