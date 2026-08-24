import type { RankedListing } from "../board";
import { getCategory } from "../categories";
import { getCity } from "../cities";

export function formatUsd(amount: number): string {
  return `$${amount.toLocaleString("en-US")}`;
}

export function formatClicks(clicks: number): string {
  return `${clicks} ${clicks === 1 ? "click" : "clicks"}`;
}

export function ListingCard({ listing }: { listing: RankedListing }) {
  const city = getCity(listing.city)?.display ?? listing.city;
  const category = getCategory(listing.category)?.display ?? listing.category;
  const lead = listing.rank === 1;
  const later = listing.rank > 1;

  return (
    <article
      className="card classified-ad"
      data-listing-card=""
      data-classified-ad=""
      data-rank={listing.rank}
      data-listing-id={listing.id}
      {...(lead ? { "data-call-ad": "lead" } : {})}
      {...(later ? { "data-call-ad": "later" } : {})}
    >
      <span className="rank">#{listing.rank}</span>
      <div className="card-body">
        {lead ? (
          <h3 className="business" data-prize="">
            {listing.business}
          </h3>
        ) : null}
        <div className="card-top">
          {later ? <h3 className="business">{listing.business}</h3> : null}
          {lead ? (
            <a
              className="outbid call-this-one call-after-claim-one call-after-claim-two call-after-claim-three call-after-claim-four call-after-claim-five"
              href={`/go/${listing.id}`}
              data-call-this-one=""
              data-call-after-claim-one=""
              data-call-after-claim-two=""
              data-call-after-claim-three=""
              data-call-after-claim-four=""
              data-call-after-claim-five=""
              aria-label={`Call this #1 at ${listing.siteHost}`}
            >
              Call this #1
            </a>
          ) : (
            <a
              className="host call-later"
              href={`/go/${listing.id}`}
              data-call-later=""
              data-call-later-quiet=""
              aria-label={`Call #${listing.rank} at ${listing.siteHost}`}
            >
              Call #{listing.rank}
            </a>
          )}
        </div>
        <p className="meta">
          <span data-category="">{category}</span>
          <span aria-hidden="true"> · </span>
          <span data-city="">{city}</span>
          {lead ? (
            <>
              <span aria-hidden="true"> · </span>
              <span className="host" data-host="">
                {listing.siteHost}
              </span>
            </>
          ) : null}
        </p>
        {lead ? (
          <p className="later-facts" data-later-fact="">
            <span className="bid" data-bid="">
              {formatUsd(listing.bidUsd)}
            </span>
            <span aria-hidden="true"> · </span>
            <span className="clicks" data-clicks="">
              {formatClicks(listing.clicks)}
            </span>
          </p>
        ) : (
          <p className="meta">
            <span className="bid" data-bid="">
              {formatUsd(listing.bidUsd)}
            </span>
            <span aria-hidden="true"> · </span>
            <span className="host" data-host="">
              {listing.siteHost}
            </span>
            <span aria-hidden="true"> · </span>
            <span className="clicks" data-clicks="">
              {formatClicks(listing.clicks)}
            </span>
          </p>
        )}
        {listing.licenseId ? (
          <p className="meta license" data-license="">
            Claimed license {listing.licenseId} (not verified).
          </p>
        ) : null}
      </div>
    </article>
  );
}
