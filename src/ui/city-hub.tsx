import type { RankedListing } from "../board";
import { CATEGORIES, type CategorySlug } from "../categories";
import type { City } from "../cities";
import { currentWeekId } from "../week";
import { ClaimColumn } from "./claim-column";
import { ClassifiedEdition } from "./edition";
import { LaneBoard } from "./lane-board";

type CityHubProps = {
  city: City;
  lanes: Readonly<Record<CategorySlug, readonly RankedListing[]>>;
  lastWeek?: Readonly<Partial<Record<CategorySlug, RankedListing>>>;
  weekId?: string;
};

export function CityHub({ city, lanes, lastWeek, weekId }: CityHubProps) {
  const openWeek = weekId ?? currentWeekId();
  const emptyPaper = CATEGORIES.every(
    (category) => (lanes[category.slug] ?? []).length === 0,
  );
  return (
    <ClassifiedEdition
      city={city}
      weekId={openWeek}
      showColumnIndex={!emptyPaper}
    >
      <div className="classified-columns" data-classified-columns="">
        {CATEGORIES.map((category) => (
          <LaneBoard
            key={category.slug}
            city={city}
            category={category}
            listings={lanes[category.slug]}
            lastWeek={lastWeek?.[category.slug]}
            weekId={openWeek}
          />
        ))}
      </div>
      <ClaimColumn city={city.slug} emptyPaper={emptyPaper} />
    </ClassifiedEdition>
  );
}
