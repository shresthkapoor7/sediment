"use client";

import Link from "next/link";
import { LogoMark } from "@/components/LogoMark";

/**
 * Renders the 404 page with navigation links to the home and discovery pages.
 */
export default function NotFound() {
  return (
    <main className="notfound-shell">
      <div className="notfound-content">
        <LogoMark className="notfound-logo" />
        <h1 className="notfound-code">
          4<em>0</em>4
        </h1>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.875rem", alignItems: "center" }}>
          <h2 className="notfound-title">This layer has eroded away</h2>
          <p className="notfound-description">
            The page you&rsquo;re looking for isn&rsquo;t in the record. It may have
            been moved, renamed, or never settled here at all.
          </p>
        </div>

        <div className="notfound-actions">
          <Link href="/" className="notfound-button is-primary">
            Back to surface
          </Link>
          <Link href="/discovery" className="notfound-button">
            Start a discovery
          </Link>
        </div>
      </div>
    </main>
  );
}
