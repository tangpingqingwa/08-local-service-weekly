import type { Metadata } from "next";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Rules · Local Service Weekly",
  description:
    "Rank is the bid. Minimum $5, older listings win ties, and raises pay only the difference.",
  alternates: { canonical: "/rules" },
};

export default function RulesPage() {
  return (
    <main className="doc-page" data-page="rules">
      <h1>Rules</h1>
      <p>
        The board follows the published rules below.{" "}
        <strong>Rank is the bid.</strong> A new listing starts at{" "}
        <strong>$5</strong>, the listing placed first wins an equal-bid tie,
        and a raise charges only the difference.
      </p>

      <h2>Ranking</h2>
      <table>
        <tbody>
          <tr>
            <th>Rank is the bid</th>
            <td>
              Within each city and category, providers are ordered by bid from
              highest to lowest. Reviews, clicks, recency, and editorial
              preference do not affect rank.
            </td>
          </tr>
          <tr>
            <th>Whole dollars</th>
            <td>Bids use whole US dollars. The step is $1.</td>
          </tr>
          <tr>
            <th>Minimum</th>
            <td>
              A new listing starts at <strong>$5</strong> or more.
            </td>
          </tr>
          <tr>
            <th>Maximum</th>
            <td>
              A bid or raise cannot exceed <strong>$999,999</strong>.
            </td>
          </tr>
          <tr>
            <th>Below #1 still lists</th>
            <td>
              A bid below the current leader still appears at the rank that
              amount can take.
            </td>
          </tr>
          <tr>
            <th>Equal bids</th>
            <td>The listing placed first keeps the higher rank.</td>
          </tr>
          <tr>
            <th>Listing identity</th>
            <td>
              A business is identified by its cleaned website, category, and
              city. Reusing that combination during an active placement is a
              raise, not a duplicate.
            </td>
          </tr>
          <tr>
            <th>Raise</th>
            <td>
              The new total must be at least $1 higher. The original payer is
              charged only the difference between the current and new bid.
            </td>
          </tr>
          <tr>
            <th>Listing ownership</th>
            <td>
              A different business cannot take over an existing listing for
              the raise amount. It submits its own listing and pays the full
              bid.
            </td>
          </tr>
          <tr>
            <th>Payment claims rank</th>
            <td>
              Rank changes only after payment is confirmed. An incomplete or
              abandoned checkout never appears on the board.
            </td>
          </tr>
        </tbody>
      </table>

      <h2>Rolling seven-day window</h2>
      <p>
        Each paid placement remains eligible for seven days from confirmation.
        The board does not reset for everyone at Monday midnight. When a
        placement expires, it leaves the live ranking; the business may return
        with a new full bid.
      </p>

      <h2>Website links</h2>
      <ol>
        <li>Use a secure, public business website.</li>
        <li>Tracking, referral, and affiliate parameters are removed.</li>
        <li>Link shorteners, chat invitations, and adult content are rejected.</li>
        <li>
          Private, local-only, credentialed, or otherwise unsafe destinations
          are rejected before checkout.
        </li>
      </ol>
      <p>
        Public clicks go to the cleaned website and never affect ranking.
      </p>

      <h2>Licenses and removals</h2>
      <p>
        Dentists and immigration lawyers must provide a visible license
        identifier. The board presents it as information supplied by the
        business, not as independent verification. Visitors should confirm
        credentials with the relevant licensing authority before hiring.
      </p>
      <p>
        A listing may be removed for an unverified professional claim,
        impersonation, a specific written complaint, adult content, prohibited
        links, or another documented policy concern. Removed listings leave
        the public ranking and cannot raise while hidden. Removal does not
        automatically create a refund or a replacement #1.
      </p>

      <p>
        <a href="/about">About this board</a>
      </p>
    </main>
  );
}
