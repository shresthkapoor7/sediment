import Link from "next/link";
import { LogoMark } from "@/components/LogoMark";
import shell from "@/components/workspaces/WorkspacesView.module.css";
import styles from "./LegalPage.module.css";

export function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <div className={`landing-shell ${shell.shell}`}>
      <div className={shell.page}>
        <header className={shell.topbar}>
          <Link href="/" className={shell.brand}><LogoMark width="28" height="28" /><span>Sediment</span></Link>
        </header>
        <main className={`${shell.main} ${styles.main}`}>
          <div className={shell.headingText}><h1>{title}</h1><p>Last updated {updated}</p></div>
          <article className={styles.body}>{children}</article>
        </main>
      </div>
    </div>
  );
}
