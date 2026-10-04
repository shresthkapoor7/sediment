import styles from "./PaperSelectionControl.module.css";

export function PaperSelectionControl({ title, selected, onToggle }: {
  title: string;
  selected: boolean;
  onToggle: () => void;
}) {
  return <label className={styles.control}>
    <input type="checkbox" checked={selected} onChange={onToggle} aria-label={`Select ${title}`} />
    <span>{selected ? "Selected" : "Select"}</span>
  </label>;
}
