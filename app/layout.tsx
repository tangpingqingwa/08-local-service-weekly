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
        <div className="sheet" data-slot="app-shell">
          <header className="site-header" data-slot="site-header">
            <div className="site-header-shell" data-slot="shell">
              <a className="logo" href="/" data-slot="brand">
                Local Service Weekly
              </a>
              <p className="tagline">London edition · Last 7 days&apos; local classified. Rank is the bid.</p>
              <nav className="site-nav" aria-label="Site" data-slot="primary-nav">
                <a href="/">Edition</a>
                <a href="#categories">Service desks</a>
                <a href="/about">About</a>
                <a href="/rules">Rules</a>
              </nav>
            </div>
          </header>
          {children}
          <footer className="maker-footer" data-maker-contact="">
            <span>Built by </span>
            <a href="mailto:tangpingqingwa@gmail.com">tangpingqingwa@gmail.com</a>
          </footer>
        </div>
      </body>
    </html>
  );
}
