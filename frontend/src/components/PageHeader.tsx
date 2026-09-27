import Link from "next/link";
import { LogoMark } from "@/components/LogoMark";
import { ThemeToggle } from "@/components/ThemeToggle";
import styles from "./PageHeader.module.css";

export function PageHeader({ title }: { title: string }) {
  return <header className={styles.header}>
    <Link href="/" className={styles.brand}><LogoMark width="23" height="23" /><span>Sediment</span></Link>
    <span className={styles.divider}>/</span>
    <span className={styles.label}>{title}<span className={styles.status}>Under development</span></span>
    <div className={styles.actions}><Link href="/">Back to home</Link><ThemeToggle /></div>
  </header>;
}
