import type { Metadata } from "next";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "About · Local Service Weekly",
  description:
    "A public London service board where local providers are ranked only by bid.",
};

export default function AboutPage() {
  return (
    <main className="doc-page" data-page="about">
      <h1>About</h1>
      <p>
        Local Service Weekly is a public auction for the{" "}
        <strong>#1 visible local-service provider</strong> in each city and
        category. Movers, dentists, immigration lawyers, and tutors bid whole
        US dollars for their position.
      </p>
      <p>
        <strong>Rank is the bid.</strong> There are no star ratings, review
        scores, or quality badges in the ranking. A bid below #1 still appears
        at the position that amount can take, and the listing placed first wins
        an equal-bid tie.
      </p>
      <p>
        London listings follow <strong>Europe/London</strong> local time. The
        board is in <strong>English</strong>, bids use <strong>USD</strong>, and
        each paid placement remains eligible for seven days.
      </p>
      <p>
        Anyone can browse without an account. A business appears only after
        payment is confirmed, and an incomplete or abandoned checkout changes
        nothing.
      </p>
      <p>
        Listing links are cleaned before publication. Tracking parameters,
        shorteners, chat invitations, adult content, and unsafe destinations
        are rejected. Dentists and immigration lawyers must provide a license
        identifier, which is shown as a claim rather than independent
        verification. Listings may be removed for policy or identity concerns.
      </p>
      <p>
        <a href="/rules">Read the rules</a> for the $5 minimum, ties, raises,
        license claims, link standards, and removal policy.
      </p>
    </main>
  );
}
