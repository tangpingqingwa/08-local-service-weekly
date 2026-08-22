import type { Metadata } from "next";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "About · Local Service Weekly",
  description:
    "Rank is the bid. Weekly #1 local-service provider by city and category. Global English. London v1. Clone of outbid.lol.",
};

export default function AboutPage() {
  return (
    <main className="doc-page" data-page="about">
      <h1>About</h1>
      <p>
        Local Service Weekly is a public weekly auction for the{" "}
        <strong>#1 visible local-service provider</strong> in a city × category.
        The #1 mover, dentist, immigration lawyer, or tutor in town is whoever
        paid the most this week.
      </p>
      <p>
        This is the <strong>outbid.lol</strong> pay-to-rank mechanic for the{" "}
        <strong>local-service-weekly</strong> vertical.{" "}
        <strong>Rank is the bid.</strong> There are no stars, no review scores,
        and no quality badges. We never invent a rating or
        &quot;patients served.&quot;
      </p>
      <p>
        The market is <strong>global English</strong>. Copy is English. Currency
        is <strong>USD</strong>. v1 ships the <strong>London</strong> city lane
        only. Adding another city is a catalog row, not a rewrite of ranking.
        Unknown city slugs 404 — we do not silently fall back to London.
      </p>
      <p>
        There are <strong>no ads</strong>, <strong>no API keys</strong>, and{" "}
        <strong>no revenue share</strong> with listed businesses. Polar is
        merchant of record when live. Tests use a fixture adapter.
      </p>
      <p>
        Site URLs are cleaned: tracking query strings are stripped. Chat and
        invite links are rejected. Adult / NSFW hosts are rejected. Link
        shorteners are not stored.
      </p>
      <p>
        <a href="/rules">Read the rules</a> for the $5 minimum, older-wins-ties,
        and raise-pays-the-difference.
      </p>
    </main>
  );
}
