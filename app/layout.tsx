import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

const SITE_URL = "https://localservice.lol";
const SITE_NAME = "Local Service Weekly";
const SITE_DESCRIPTION =
  "Compare paid local-service listings in London by category on a transparent rolling seven-day classified. Rank is the bid.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: SITE_NAME, template: "%s | Local Service Weekly" },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: ["London local services", "London movers", "London dentists", "local service directory"],
  creator: SITE_NAME,
  publisher: SITE_NAME,
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [{ url: "/brand-mark.svg", type: "image/svg+xml" }],
    shortcut: "/brand-mark.svg",
  },
  openGraph: {
    type: "website",
    locale: "en_GB",
    url: SITE_URL,
    siteName: SITE_NAME,
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    images: [{ url: "/brand-mark.png", width: 512, height: 512, alt: "Local Service Weekly classified" }],
  },
  twitter: {
    card: "summary",
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    images: ["/brand-mark.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
  },
};

const structuredData = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: SITE_NAME,
  url: SITE_URL,
  description: SITE_DESCRIPTION,
  inLanguage: "en-GB",
  isAccessibleForFree: true,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
      </head>
      <body>
        <div className="sheet" data-slot="app-shell">
          <header className="site-header" data-slot="site-header">
            <div className="site-header-shell" data-slot="shell">
              <a className="logo" href="/" data-slot="brand">
                <img className="brand-mark" src="/brand-mark.svg" width="28" height="28" alt="" aria-hidden="true" />
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
