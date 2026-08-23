import { CATEGORIES } from "../categories";
import { MIN_BID_USD } from "../constants";

export function ClaimColumn({ city }: { city: string }) {
  return (
    <section className="claim claim-pick" id="claim" data-claim-pick="">
      <h2>
        <span>Claim #1 for</span>
        <span className="amount-stepper">
          <span className="amount-field" aria-hidden="true">
            ${MIN_BID_USD}
          </span>
        </span>
      </h2>
      <p className="claim-note">
        Pick one column. New spots start at ${MIN_BID_USD}. Rank is the bid.
      </p>
      <nav
        className="claim-columns"
        aria-label="Claim a classified column"
        data-claim-columns=""
      >
        {CATEGORIES.map((item) => (
          <a
            key={item.slug}
            className="outbid"
            href={`/c/${city}/${item.slug}#claim`}
            data-claim-column={item.slug}
            data-claim-job={item.slug}
          >
            {`Outbid my ${item.display.toLowerCase()} column`}
          </a>
        ))}
      </nav>
    </section>
  );
}
