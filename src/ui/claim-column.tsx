import { CATEGORIES } from "../categories";
import { MIN_BID_USD } from "../constants";

type ClaimColumnProps = {
  city: string;
  emptyPaper?: boolean;
};

export function ClaimColumn({ city, emptyPaper = false }: ClaimColumnProps) {
  const columns = (
    <nav
      className={emptyPaper ? "claim-columns claim-next" : "claim-columns"}
      aria-label={
        emptyPaper ? "Pick a classified column" : "Claim a classified column"
      }
      data-claim-columns=""
    >
      {CATEGORIES.map((item) => (
        <a
          key={item.slug}
          href={`/c/${city}/${item.slug}#claim`}
          data-claim-column={item.slug}
          data-claim-job={item.slug}
        >
          {emptyPaper
            ? item.display
            : `Outbid my ${item.display.toLowerCase()} column`}
        </a>
      ))}
    </nav>
  );

  if (emptyPaper) {
    return (
      <section className="claim claim-pick claim-first" id="claim" data-claim-pick="">
        <details>
          <summary className="outbid claim-first-click">
            <span>Claim #1 for</span>
            <span className="amount-stepper">
              <span className="amount-field" aria-hidden="true">
                ${MIN_BID_USD}
              </span>
            </span>
          </summary>
          <p className="claim-note">
            Then pick the column. New spots start at ${MIN_BID_USD}. Rank is the
            bid. Unpaid checkout stays off the board until Polar reports paid.
          </p>
          {columns}
        </details>
      </section>
    );
  }

  return (
    <section
      className="claim claim-pick later-claim"
      id="claim"
      data-claim-pick=""
      data-later-claim=""
    >
      <p className="later-claim-label">Then Claim #1</p>
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
        Unpaid checkout stays off the board until Polar reports paid. An
        abandoned listing is not #1.
      </p>
      {columns}
    </section>
  );
}
