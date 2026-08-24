import type { ReactNode } from "react";
import type { City } from "../cities";
import { formatWeekLabel } from "../week";

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
        <p className="edition-kicker">This week&apos;s local classified</p>
        <p className="folio" data-edition-week={weekId}>
          Week of {formatWeekLabel(weekId)} · Europe/London · Vol. {weekId}
        </p>
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
