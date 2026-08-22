import type { Category } from "../categories";
import type { City } from "../cities";
import type { RankedListing } from "../board";
import { ListingCard } from "./listing-card";
import { OutbidForm } from "./outbid-form";

type LaneBoardProps = {
  city: City;
  category: Category;
  listings: readonly RankedListing[];
  showForm?: boolean;
};

export function LaneBoard({
  city,
  category,
  listings,
  showForm = false,
}: LaneBoardProps) {
  return (
    <section
      className="lane"
      data-lane=""
      data-city={city.slug}
      data-category={category.slug}
    >
      <header className="lane-header">
        <h2>
          <a href={`/c/${city.slug}/${category.slug}`}>
            {city.display} / {category.display}
          </a>
        </h2>
        <p>Rank is the bid. No stars.</p>
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
