import { isProviderPaidListing, type RankedListing } from "../board";
import { getCategory } from "../categories";
import { getCity } from "../cities";

export function formatUsd(amount: number): string {
  return "$" + amount.toLocaleString("en-US");
}

export function formatClicks(clicks: number): string {
  return clicks.toLocaleString("en-US") + " " + (clicks === 1 ? "click" : "clicks");
}

export function ListingCard({
  listing,
  displayRank: _displayRank,
}: {
  listing: RankedListing;
  /**
   * Kept in the prop shape for callers compiled against the prior home
   * renderer. The local paper always displays the persisted lane rank.
   */
  displayRank?: number;
}) {
  if (!isProviderPaidListing(listing)) return null;

  const city = getCity(listing.city)?.display ?? listing.city;
  const category = getCategory(listing.category)?.display ?? listing.category;
  const lead = listing.rank === 1;

  return (
    <article
      className="card classified-ad local-ad-slip"
      data-slot="listing-card"
      id={"listing-" + listing.id}
      data-listing-card=""
      data-classified-ad=""
      data-rank={listing.rank}
      data-listing-id={listing.id}
      data-provider-paid=""
      data-bid-usd={listing.bidUsd}
      data-created-at={listing.createdAt}
      {...(lead ? { "data-call-ad": "lead" } : { "data-call-ad": "later" })}
    >
      <span className="rank" data-slot="card-rank" aria-label={"Rank " + listing.rank}>
        {"#" + listing.rank}
      </span>
      <div className="card-body" data-slot="listing-body">
        <div className="card-heading">
          <span className="card-kicker">{lead ? "Lead service" : "Paid placement"}</span>
          <h3 className="business" {...(lead ? { "data-prize": "" } : {})}>
            {listing.business}
          </h3>
        </div>

        {lead ? (
          <p className="card-action">
            <a
              className="outbid call-this-one"
              href={"/go/" + listing.id}
              data-call-this-one=""
              data-first-click="call"
              aria-label={"Call this #1 at " + listing.siteHost}
            >
              Call this #1
            </a>
          </p>
        ) : (
          <p className="later-call" data-later-call="">
            <a
              className="host call-later"
              href={"/go/" + listing.id}
              data-call-later=""
              aria-label={"Call #" + listing.rank + " at " + listing.siteHost}
            >
              {"Call #" + listing.rank}
            </a>
          </p>
        )}

        <p className="meta card-service-fact">
          <span data-category="">{category}</span>
          <span aria-hidden="true"> · </span>
          <span data-city="">{city}</span>
          <span aria-hidden="true"> · </span>
          <span className="host" data-host="">
            {listing.siteHost}
          </span>
        </p>
        <p className={lead ? "later-facts card-ledger" : "meta card-ledger"} data-later-fact="">
          <span className="bid" data-bid="">
            {formatUsd(listing.bidUsd)}
          </span>
          <span aria-hidden="true"> · </span>
          <span className="clicks" data-clicks="">
            {formatClicks(listing.clicks)}
          </span>
        </p>
        {listing.licenseId ? (
          <p className="meta license" data-license="">
            {"Claimed license " + listing.licenseId + " (not verified)."}
          </p>
        ) : null}
      </div>
    </article>
  );
}
