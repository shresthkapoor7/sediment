import type { CSSProperties } from "react";
import styles from "./FeedBackdrop.module.css";

const topics = [
  { name: "Machine learning", image: "neural-networks" },
  { name: "Neuroscience", image: "neuroscience" },
  { name: "Climate science", image: "climate" },
  { name: "Quantum physics", image: "quantum" },
  { name: "Robotics", image: "robotics" },
  { name: "Life sciences", image: "molecules" },
  { name: "Space science", image: "space" },
  { name: "Mathematics", image: "mathematics" },
  { name: "Language models", image: "language" },
  { name: "Ecology", image: "ecology" },
  { name: "Computer vision", image: "vision" },
  { name: "Energy", image: "energy" },
  { name: "Genetics", image: "genetics" },
  { name: "Reinforcement learning", image: "reinforcement" },
];

export function FeedBackdrop() {
  return <div className={styles.backdrop} aria-hidden="true">
    {[topics.slice(0, 7), topics.slice(7)].map((side, index) => <div className={styles.orbit} key={index}>
      <div className={styles.wheel}>
        {side.map((topic, position) => <div className={styles.slot} key={topic.image} style={{ "--angle": `${position * 360 / side.length}deg` } as CSSProperties}>
          <div className={styles.counter}>
            <div className={styles.card}>
              {/* Decorative local SVGs need no image transformation service. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/feed-illustrations/${topic.image}.svg`} alt="" width="180" height="100" />
              <div className={styles.body}><span>{topic.name}</span><i /><i /><i /></div>
            </div>
          </div>
        </div>)}
      </div>
    </div>)}
  </div>;
}
