import { isPolarPaidListing, rankLane, type RankedListing } from "../board";
import type { Category } from "../categories";
import type { City } from "../cities";
import { ListingCard } from "./listing-card";
import { OutbidForm } from "./outbid-form";

type LaneBoardProps = {
  city: City;
  category: Category;
  listings: readonly RankedListing[];
  lastWeek?: RankedListing;
  weekId?: string;
  showForm?: boolean;
};

export function LaneBoard({
  city,
  category,
  listings,
  lastWeek,
  weekId,
  showForm = false,
}: LaneBoardProps) {
  const paid = rankLane(listings);
  const occupied = paid.length > 0;
  const lead = paid.find((listing) => listing.rank === 1);
  const lastCall = [...paid].reverse().find((listing) => listing.rank > 1);
  const lastWeekPaid =
    lastWeek && isPolarPaidListing(lastWeek) ? lastWeek : undefined;

  return (
    <section
      className={
        occupied
          ? "lane classified-column lane-occupied"
          : "lane classified-column lane-empty"
      }
      data-lane=""
      data-city={city.slug}
      data-category={category.slug}
      data-week={weekId}
      {...(occupied
        ? { "data-lane-occupied": "true" }
        : { "data-lane-empty": "true" })}
    >
      <header className="lane-header">
        <h2>
          <a href={`/c/${city.slug}/${category.slug}`}>{category.display}</a>
        </h2>
        <p>Want ads. Rank is the bid.</p>
      </header>
      {paid.length === 0 ? (
        <div
          className="empty-lane"
          data-empty-lane="true"
          data-empty-honest=""
        >
          <p className="empty-answer">No #1</p>
          <p className="empty-note">
            This lane is empty. Rank is the bid. No stars. No map. Unpaid
            checkout stays off the board until Polar reports paid. An abandoned
            listing is not #1.
          </p>
        </div>
      ) : (
        <>
          <ol
            className="leaderboard"
            data-leaderboard=""
            data-rolling-week=""
          >
            {paid.map((listing) => (
              <li key={listing.id}>
                <ListingCard listing={listing} />
              </li>
            ))}
          </ol>
          {lead ? (
            <p className="later-claim claim-after-call-line" data-later-claim="">
              <a
                className="claim-after-call claim-after-call-one claim-after-call-two claim-after-call-three claim-after-call-four claim-after-call-five"
                href={`/c/${city.slug}/${category.slug}#claim`}
                data-claim-after-call=""
                data-claim-after-call-one=""
                data-claim-after-call-two=""
                data-claim-after-call-three=""
                data-claim-after-call-four=""
                data-claim-after-call-five=""
                data-claim-job={category.slug}
              >
                {`Outbid my ${category.display.toLowerCase()} column`}
              </a>{" "}
              after Call this #1. Paying less than #1 still lists. Rank is the
              bid.
            </p>
          ) : null}
          {lastCall ? (
            <p className="later-call call-after-claim-line" data-later-call="">
              <a
                className="host call-later call-after-claim"
                href={`/go/${lastCall.id}`}
                data-call-after-claim=""
                aria-label={`Call #${lastCall.rank} after the claim hop at ${lastCall.siteHost}`}
              >
                {`Call #${lastCall.rank}`}
              </a>{" "}
              after the claim hop.
            </p>
          ) : null}
        </>
      )}
      {lastWeekPaid ? (
        <aside className="last-week" data-last-week="">
          <p>
            Last week #1: <strong>{lastWeekPaid.business}</strong> at $
            {lastWeekPaid.bidUsd}. Not this week&apos;s #1 unless they pay
            again.
          </p>
        </aside>
      ) : null}
      {showForm ? (
        <OutbidForm
          city={city.slug}
          category={category.slug}
          lockCity
          lockCategory
          emptyPaper={paid.length === 0}
        />
      ) : null}
    </section>
  );
}
