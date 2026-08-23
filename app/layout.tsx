import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Local Service Weekly",
  description:
    "This week's local classified. Rank is the bid. Weekly #1 local-service provider by city and category.",
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
            <p className="tagline">A weekly classified. Rank is the bid.</p>
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
