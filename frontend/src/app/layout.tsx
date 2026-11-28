import type { Metadata } from "next";
import Script from "next/script";
import { Inter, Geist, Geist_Mono, Source_Serif_4 } from "next/font/google";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AuthProvider } from "@/components/AuthProvider";
import { siteJsonLd } from "@/lib/jsonld";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
  style: ["normal", "italic"],
  axes: ["opsz"],
});

// The home screen's sans (see `.landing-shell` in globals.css); the rest of the app stays on Inter.
const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
  weight: ["400", "500"],
});

// Source Serif is only used for the hero equations — italic axis alone.
const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  variable: "--font-serif",
  display: "swap",
  style: "italic",
});

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://www.sediment-ai.com";
const description = "An infinite canvas for literature review: search OpenAlex, map paper lineages, and work through a field with an agent on your board.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Sediment | Canvas for modern research",
  description,
  openGraph: {
    url: SITE_URL,
    title: "Sediment",
    description,
    siteName: "Sediment",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Sediment",
    description,
  },
  appleWebApp: {
    capable: true,
    title: "Sediment",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      data-theme="dark"
      className={`${inter.variable} ${geistSans.variable} ${geistMono.variable} ${sourceSerif.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Prevent flash of wrong theme */}
        <Script
          id="theme-preference"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                var t = 'dark';
                try { t = localStorage.getItem('sediment-theme') || 'dark'; } catch (_) {}
                if (t !== 'light') t = 'dark';
                document.documentElement.setAttribute('data-theme', t);
              })();
            `,
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(siteJsonLd).replace(/</g, "\\u003c"),
          }}
        />
      </head>
      <body suppressHydrationWarning>
        <ThemeProvider><AuthProvider>{children}</AuthProvider></ThemeProvider>
      </body>
    </html>
  );
}
