import type { ReactNode } from "react";
import type { City } from "../cities";

type ClassifiedEditionProps = {
  city: City;
  weekId: string;
  emptyPaper?: boolean;
  claim?: ReactNode;
  children: ReactNode;
};

/**
 * Local Service Weekly is one classified-paper surface. The rolling window is
 * a truthful label; it is not a second ranking mode or presentation branch.
 */
export function ClassifiedEdition({
  city,
  weekId,
  emptyPaper = false,
  claim,
  children,
}: ClassifiedEditionProps) {
  return (
    <main
      className={emptyPaper ? "paper classified paper-empty" : "paper classified paper-occupied"}
      data-board=""
      data-classified=""
      data-slot="home-shell"
      data-city={city.slug}
      data-week={weekId}
      data-window="rolling-seven-days"
      {...(claim ? { "data-hero-claim": "true" } : {})}
      {...(emptyPaper
        ? { "data-paper-empty": "true" }
        : { "data-paper-occupied": "true" })}
    >
      <header className="edition" data-edition="" data-slot="edition-shell">
        <div className="edition-brandline">
          <p className="edition-kicker">Local Service Weekly · London edition</p>
          <p className="folio" data-edition-week={weekId}>
            Rolling last 7 days. Not Monday 00:00 Europe/London.
          </p>
        </div>
        <h1 className="edition-city">{city.display}</h1>
        <p className="edition-dek">
          Four service desks for London. The first call in each desk is the
          provider who paid the most in the rolling seven-day window. Rank is
          the bid.
        </p>
        {claim}
      </header>
      {children}
    </main>
  );
}
