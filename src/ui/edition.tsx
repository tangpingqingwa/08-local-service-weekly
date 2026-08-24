import type { ReactNode } from "react";
import { CATEGORIES } from "../categories";
import type { City } from "../cities";
import { formatWeekLabel } from "../week";

type ClassifiedEditionProps = {
  city: City;
  weekId: string;
  claim?: ReactNode;
  showColumnIndex?: boolean;
  children: ReactNode;
};

export function ClassifiedEdition({
  city,
  weekId,
  claim,
  showColumnIndex = true,
  children,
}: ClassifiedEditionProps) {
  return (
    <main
      className="paper classified"
      data-board=""
      data-classified=""
      data-city={city.slug}
      data-week={weekId}
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
        {showColumnIndex ? (
          <nav
            className="column-index"
            aria-label="Classified columns"
            data-category-tabs=""
          >
            {CATEGORIES.map((category) => (
              <a
                key={category.slug}
                href={`/c/${city.slug}/${category.slug}`}
                data-category={category.slug}
              >
                {category.display}
              </a>
            ))}
          </nav>
        ) : null}
      </header>
      {children}
    </main>
  );
}
