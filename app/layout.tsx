import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Local Service Weekly",
  description:
    "Rank is the bid. Weekly #1 local-service provider by city and category.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <a className="logo" href="/">
            Local Service Weekly
          </a>
          <p className="tagline">Rank is the bid. London, this week.</p>
          <nav className="site-nav" aria-label="Site">
            <a href="/about">About</a>
            <a href="/rules">Rules</a>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
