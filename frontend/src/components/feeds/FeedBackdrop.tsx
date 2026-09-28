import styles from "./FeedBackdrop.module.css";

const topics = [
  { name: "Machine learning", image: "neural-networks" },
  { name: "Neuroscience", image: "neuroscience" },
  { name: "Climate science", image: "climate" },
  { name: "Quantum physics", image: "quantum" },
  { name: "Robotics", image: "robotics" },
  { name: "Life sciences", image: "molecules" },
];

export function FeedBackdrop() {
  return <div className={styles.backdrop} aria-hidden="true">
    {[topics.slice(0, 3), topics.slice(3)].map((side, index) => <div className={styles.rail} key={index}>
      {side.map(topic => <div className={styles.card} key={topic.image}>
        {/* Decorative local SVGs need no image transformation service. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/feed-illustrations/${topic.image}.svg`} alt="" width="220" height="122" />
        <div className={styles.body}><span>{topic.name}</span><i /><i /><i /></div>
      </div>)}
    </div>)}
  </div>;
}
