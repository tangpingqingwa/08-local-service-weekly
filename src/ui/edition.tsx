import type { ReactNode } from "react";
import type { City } from "../cities";

type ClassifiedEditionProps = {
  city: City;
  weekId: string;
  emptyPaper?: boolean;
  claim?: ReactNode;
  children: ReactNode;
};

export function ClassifiedEdition({
  city,
  weekId,
  emptyPaper = false,
  claim,
  children,
}: ClassifiedEditionProps) {
  return (
    <main
      className={
        emptyPaper
          ? "paper classified paper-empty"
          : "paper classified paper-occupied"
      }
      data-board=""
      data-classified=""
      data-city={city.slug}
      data-week={weekId}
      {...(emptyPaper
        ? { "data-paper-empty": "true" }
        : { "data-paper-occupied": "true" })}
    >
      <header className="edition" data-edition="">
        {emptyPaper ? (
          <p className="edition-kicker">Last 7 days&apos; local classified</p>
        ) : (
          <p className="edition-kicker">This week&apos;s local classified</p>
        )}
        {emptyPaper ? (
          <p className="folio" data-edition-week={weekId}>
            Rolling last 7 days. Not Monday 00:00 Europe/London.
          </p>
        ) : (
          <p
            className="folio week-window"
            data-edition-week={weekId}
            data-rolling-week=""
          >
            Rolling last 7 days. Not Monday 00:00 Europe/London.
          </p>
        )}
        <h1 className="edition-city">{city.display}</h1>
        <p className="edition-dek">
          Four classified columns. The #1 mover, dentist, immigration lawyer, or
          tutor in this edition is whoever paid the most. Rank is the bid.
        </p>
        {claim}
      </header>
      {children}
    </main>
  );
}
