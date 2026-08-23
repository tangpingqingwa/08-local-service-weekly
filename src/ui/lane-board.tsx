import type { RankedListing } from "../board";
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
  return (
    <section
      className="lane classified-column"
      data-lane=""
      data-city={city.slug}
      data-category={category.slug}
      data-week={weekId}
    >
      <header className="lane-header">
        <h2>
          <a href={`/c/${city.slug}/${category.slug}`}>{category.display}</a>
        </h2>
        <p>Want ads. Rank is the bid.</p>
      </header>
      {listings.length === 0 ? (
        <p className="empty-lane" data-empty-lane="true">
          This lane is empty.
        </p>
      ) : (
        <ol className="leaderboard" data-leaderboard="">
          {listings.map((listing) => (
            <li key={listing.id}>
              <ListingCard listing={listing} />
            </li>
          ))}
        </ol>
      )}
      {lastWeek ? (
        <aside className="last-week" data-last-week="">
          <p>
            Last week #1: <strong>{lastWeek.business}</strong> at $
            {lastWeek.bidUsd}. Not this week&apos;s #1 unless they pay again.
          </p>
        </aside>
      ) : null}
      {showForm ? (
        <OutbidForm
          city={city.slug}
          category={category.slug}
          lockCity
          lockCategory
        />
      ) : null}
    </section>
  );
}
