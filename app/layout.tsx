import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Local Service Weekly",
  description:
    "Last 7 days' local classified. Rank is the bid. #1 local-service provider by city and category.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="sheet">
          <header className="site-header">
            <a className="logo" href="/">
              Local Service Weekly
            </a>
            <p className="tagline">Last 7 days&apos; local classified. Rank is the bid.</p>
            <nav className="site-nav" aria-label="Site">
              <a href="/">Edition</a>
              <a href="/about">About</a>
              <a href="/rules">Rules</a>
            </nav>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
