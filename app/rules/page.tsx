import type { Metadata } from "next";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Rules · Local Service Weekly",
  description:
    "Rank is the bid. Min $5. Older wins ties. Raise pays the difference. London v1. Global English.",
};

export default function RulesPage() {
  return (
    <main className="doc-page" data-page="rules">
      <h1>Rules</h1>
      <p>
        A bidder can predict rank from this page alone.{" "}
        <strong>Rank is the bid.</strong> New listings start at{" "}
        <strong>min $5</strong>. Equal bids: the <strong>older</strong> listing
        wins. A raise pays only the <strong>difference</strong>.
      </p>

      <h2>Ranking</h2>
      <table>
        <tbody>
          <tr>
            <th>Rank is the bid</th>
            <td>
              Inside one lane (city × category, rolling last 7 days), sort by{" "}
              <code>bidUsd</code> descending. Nothing else — no recency boost,
              no quality score, no invented ratings.
            </td>
          </tr>
          <tr>
            <th>Whole dollars</th>
            <td>Bids are integers. No cents. Step is $1. Currency is USD.</td>
          </tr>
          <tr>
            <th>Minimum</th>
            <td>
              A new listing must be <strong>min $5</strong>.
            </td>
          </tr>
          <tr>
            <th>Maximum</th>
            <td>
              Any bid (first or raise) must be <strong>≤ $999,999</strong>.
            </td>
          </tr>
          <tr>
            <th>Below #1 still lists</th>
            <td>
              Paying less than #1 still appears at the rank that bid can take.
            </td>
          </tr>
          <tr>
            <th>Equal bids</th>
            <td>
              The <strong>older</strong> listing (smaller{" "}
              <code>createdAt</code>) keeps the higher rank.
            </td>
          </tr>
          <tr>
            <th>Identity</th>
            <td>
              A listing is <code>canonical site URL + category + city</code>.{" "}
              <code>weekId</code> stays a Polar/audit label, not a Monday paper.
              Business name may change on raise; the key does not.
            </td>
          </tr>
          <tr>
            <th>Raise</th>
            <td>
              Same identity, new amount <code>N</code>. Require{" "}
              <code>N ≥ current + 1</code>. Payer pays only the{" "}
              <strong>difference</strong> (<code>N − current</code>).{" "}
              <code>createdAt</code> does not change, so the older stamp still
              wins ties.
            </td>
          </tr>
          <tr>
            <th>Cannot steal the difference</th>
            <td>
              A different business cannot take a rank by paying only the
              difference the occupant would pay to raise. They must bid a
              strictly higher amount than the occupant&apos;s <code>bidUsd</code>.
            </td>
          </tr>
          <tr>
            <th>Payment claims rank</th>
            <td>
              A completed Polar payment (or fixture <code>paid</code>) claims
              the rank. Unpaid checkout drafts never appear.
            </td>
          </tr>
        </tbody>
      </table>

      <h2>Last 7 days</h2>
      <p>
        Occupied rank is the rolling last 7 days from paid placement.{" "}
        <strong>Rolling last 7 days. Not Monday 00:00 Europe/London.</strong>{" "}
        <code>weekId</code> stays that Monday&apos;s ISO date as a Polar/audit
        label, not public expiry. A listing older than 7 days is not current #1
        unless they pay again. Not a 24-hour lock on #1. v1 public city is{" "}
        <strong>London</strong>.
      </p>

      <h2>Site URLs</h2>
      <ol>
        <li>
          Require <code>https:</code>. <code>http:</code> is stored as{" "}
          <code>https:</code> when the host is unchanged.
        </li>
        <li>
          Strip tracking / affiliate query keys (<code>utm_*</code>,{" "}
          <code>gclid</code>, <code>fbclid</code>, <code>ref</code>,{" "}
          <code>ref_id</code>, <code>affiliate</code>, <code>via</code>,{" "}
          <code>mc_cid</code>, <code>mc_eid</code>). Drop the fragment.
          Lowercase the host. Trailing slash is ignored for identity.
        </li>
        <li>
          Link shorteners are not stored. Unresolved shortener host →{" "}
          <code>400 url_shortener</code>.
        </li>
        <li>
          Chat / invite hosts (Telegram, <code>t.me</code>, WhatsApp,{" "}
          <code>wa.me</code>, <code>discord.gg</code>,{" "}
          <code>discord.com/invite</code>, <code>m.me</code>,{" "}
          <code>signal.me</code>) → <code>400 chat_link</code>.
        </li>
        <li>
          NSFW / adult hosts and path keywords → <code>400 nsfw</code>.
        </li>
      </ol>
      <p>
        Clicks go to the cleaned URL with <strong>no</strong> query string added
        by us.
      </p>

      <h2>Licenses and takedown</h2>
      <p>
        Dentists and immigration lawyers must submit a claimed{" "}
        <code>licenseId</code> (2–64 visible characters). Missing →{" "}
        <code>400 license_required</code>. The site does <strong>not</strong>{" "}
        assert the license is valid. It is a claimed string, not a
        verification. v1 does not call a government license API.
      </p>
      <p>
        An operator can hide a listing for <code>unlicensed</code>,{" "}
        <code>impersonation</code>, a written <code>complaint</code> that names
        the listing + city + category, <code>nsfw</code>,{" "}
        <code>chat_link</code>, or <code>other</code>. Hidden listings drop off
        the public board and
        vacate rank. The bid is <strong>not</strong> auto-refunded. A hidden
        listing cannot raise until unhidden. A taken-down #1 is not replaced
        with an invented business.
      </p>

      <p>
        <a href="/about">About this board</a>
      </p>
    </main>
  );
}
