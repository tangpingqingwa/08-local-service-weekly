import { CATEGORIES } from "../categories";
import { MIN_BID_USD } from "../constants";

type ClaimColumnProps = {
  city: string;
  emptyPaper?: boolean;
  visualOnly?: boolean;
};

function ColumnLinks({
  city,
  emptyPaper,
  visualOnly = false,
}: {
  city: string;
  emptyPaper: boolean;
  visualOnly?: boolean;
}) {
  return (
    <nav
      className={
        visualOnly
          ? "claim-columns claim-columns-quiet"
          : emptyPaper
            ? "claim-columns claim-next"
            : "claim-columns"
      }
      aria-label={
        emptyPaper ? "Pick a classified column" : "Claim a classified column"
      }
      data-claim-columns=""
      data-slot="claim-column-links"
    >
      {!visualOnly ? null : (
        <span className="claim-columns-label">Choose a service desk</span>
      )}
      {CATEGORIES.map((item) => (
        <a
          key={item.slug}
          href={"/c/" + city + "/" + item.slug + "#claim"}
          data-claim-column={item.slug}
          data-claim-job={item.slug}
        >
          {visualOnly || emptyPaper
            ? item.display
            : "Claim rank in " + item.display.toLowerCase() + " column"}
        </a>
      ))}
    </nav>
  );
}

export function ClaimColumn({
  city,
  emptyPaper = false,
  visualOnly = false,
}: ClaimColumnProps) {
  if (visualOnly) {
    return (
      <section className="claim claim-column-quiet" data-slot="claim-links">
        <ColumnLinks city={city} emptyPaper={emptyPaper} visualOnly />
      </section>
    );
  }

  if (emptyPaper) {
    return (
      <section
        className="claim claim-pick claim-first"
        id="claim"
        data-claim-pick=""
        data-slot="claim-picker"
      >
        <details>
          <summary className="outbid claim-first-click">
            <span>Claim #1 for</span>
            <span className="amount-stepper">
              <span className="amount-field" aria-hidden="true">
                {"$" + MIN_BID_USD}
              </span>
            </span>
          </summary>
          <p className="claim-note">
            Then pick the service desk. Rank is the bid. An incomplete checkout
            stays off the board.
          </p>
          <ColumnLinks city={city} emptyPaper />
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
      data-slot="claim-support"
      data-raise-difference=""
    >
      <h2>
        <span>Then Claim #1 for</span>
        <span className="amount-stepper">
          <span className="amount-field" aria-hidden="true">
            {"$" + MIN_BID_USD}
          </span>
        </span>
      </h2>
      <p className="claim-note">
        Pick one service desk. A raise charges only the difference, not a full
        rebid. Paying less than #1 still lists. Rank is the bid.
      </p>
      <ColumnLinks city={city} emptyPaper={false} />
    </section>
  );
}
