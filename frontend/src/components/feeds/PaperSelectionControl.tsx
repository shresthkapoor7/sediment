import styles from "./PaperSelectionControl.module.css";

export function PaperSelectionControl({ title, selected, onToggle }: {
  title: string;
  selected: boolean;
  onToggle: () => void;
}) {
  return <button className={styles.control} type="button" aria-pressed={selected} aria-label={`Mark ${title}`} onClick={onToggle}>
    <svg width="15" height="17" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
      <rect x="3" y="3" width="12" height="12" rx="3" />
      {selected ? <path d="m6 9 2 2 4-4" /> : <path d="M6 9h6M9 6v6" />}
    </svg>
    {selected ? "Marked" : "Mark"}
  </button>;
}
