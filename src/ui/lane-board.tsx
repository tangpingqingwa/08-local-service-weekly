import { isProviderPaidListing, rankLane, type RankedListing } from "../board";
import type { Category } from "../categories";
import type { City } from "../cities";
import { ListingCard } from "./listing-card";
import { OutbidForm } from "./outbid-form";
import { FormErrorNotice } from "./form-error";

type LaneBoardProps = {
  city: City;
  category: Category;
  listings: readonly RankedListing[];
  lastWeek?: RankedListing;
  weekId?: string;
  showForm?: boolean;
  formError?: string;
  /**
   * Retained as a source-compatible prop for older callers. The classified
   * paper renders every real paid row in its own lane.
   */
  canonicalCount?: number;
  displayRankStart?: number;
  renderCanonical?: boolean;
};

export function LaneBoard({
  city,
  category,
  listings,
  lastWeek,
  weekId,
  showForm = false,
  formError,
}: LaneBoardProps) {
  const paid = rankLane(listings);
  const occupied = paid.length > 0;
  const lead = paid[0];
  const lastWeekPaid =
    lastWeek && isProviderPaidListing(lastWeek) ? lastWeek : undefined;

  return (
    <section
      className={
        occupied
          ? "lane classified-column lane-occupied"
          : "lane classified-column lane-empty"
      }
      data-lane=""
      data-slot="lane"
      data-city={city.slug}
      data-category={category.slug}
      data-week={weekId}
      {...(occupied
        ? { "data-lane-occupied": "true" }
        : { "data-lane-empty": "true" })}
    >
      <header className="lane-header" data-slot="lane-heading">
        <p className="lane-index">Service desk</p>
        <h2>
          <a href={"/c/" + city.slug + "/" + category.slug}>{category.display}</a>
        </h2>
        <p>Paid placement. Rank is the bid.</p>
      </header>
      {formError ? <FormErrorNotice code={formError} /> : null}
      {paid.length === 0 ? (
        <div
          className="empty-lane"
          data-empty-lane="true"
          data-slot="empty-lane"
          data-empty-honest=""
        >
          <p className="empty-answer">No #1</p>
          <p className="empty-note">
            No paid listing in this desk yet. Ratings and map position do not
            affect the board. An incomplete checkout stays off the paper.
          </p>
        </div>
      ) : (
        <>
          <ol
            className="leaderboard"
            data-leaderboard=""
            data-slot="paid-card-list"
          >
            {paid.map((listing) => (
              <li key={listing.id} data-slot="lane-card">
                <ListingCard listing={listing} />
              </li>
            ))}
          </ol>
          {lead ? (
            <p
              className="later-claim"
              data-later-claim=""
              data-slot="raise-support"
              data-raise-difference=""
            >
              <a
                className="claim-route"
                href={"/c/" + city.slug + "/" + category.slug + "#claim"}
                data-claim-job={category.slug}
              >
                {"Outbid my " + category.display.toLowerCase() + " column"}
              </a>{" "}
              <span className="raise-charge" data-raise-charge="">
                A raise charges only the difference, not a full rebid.
              </span>{" "}
              Paying less than #1 still lists. Rank is the bid.
            </p>
          ) : null}
        </>
      )}
      {lastWeekPaid ? (
        <aside
          className="last-week"
          data-last-week=""
          data-slot="last-week-note"
          data-aged-out=""
        >
          <p>
            Aged out of the last 7 days: <strong>{lastWeekPaid.business}</strong>{" "}
            at {"$" + lastWeekPaid.bidUsd}. Not current #1 unless they pay again.
          </p>
        </aside>
      ) : null}
      {showForm ? (
        <OutbidForm
          city={city.slug}
          category={category.slug}
          lockCity
          lockCategory
          emptyPaper={!occupied}
          topBidUsd={lead?.bidUsd}
        />
      ) : null}
    </section>
  );
}
