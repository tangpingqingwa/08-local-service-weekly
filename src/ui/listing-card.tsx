import { getCategory } from "../categories";
import { getCity } from "../cities";
import type { RankedListing } from "../board";

export function formatUsd(amount: number): string {
  return `$${amount.toLocaleString("en-US")}`;
}

export function formatClicks(clicks: number): string {
  return `${clicks} ${clicks === 1 ? "click" : "clicks"}`;
}

export function ListingCard({ listing }: { listing: RankedListing }) {
  const city = getCity(listing.city)?.display ?? listing.city;
  const category = getCategory(listing.category)?.display ?? listing.category;

  return (
    <article
      className="card"
      data-listing-card=""
      data-rank={listing.rank}
      data-listing-id={listing.id}
    >
      <span className="rank">#{listing.rank}</span>
      <div className="card-body">
        <div className="card-top">
          <h3 className="business">{listing.business}</h3>
          <p className="bid" data-bid="">
            {formatUsd(listing.bidUsd)}
          </p>
        </div>
        <p className="meta">
          <span data-city="">{city}</span>
          <span aria-hidden="true"> · </span>
          <span data-category="">{category}</span>
        </p>
        <p className="meta">
          <span className="clicks" data-clicks="">
            {formatClicks(listing.clicks)}
          </span>
          <span aria-hidden="true"> · </span>
          <span className="host" data-host="">
            {listing.siteHost}
          </span>
        </p>
      </div>
    </article>
  );
}
