import { rankLane, type RankedListing } from "../board";
import { CATEGORIES, type CategorySlug } from "../categories";
import type { City } from "../cities";
import { currentWeekId } from "../week";
import { ClaimColumn } from "./claim-column";
import { ColumnIndex } from "./column-index";
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
  const paidLanes = Object.fromEntries(
    CATEGORIES.map((category) => [
      category.slug,
      rankLane(lanes[category.slug] ?? []),
    ]),
  ) as Record<CategorySlug, RankedListing[]>;
  const emptyPaper = CATEGORIES.every(
    (category) => paidLanes[category.slug].length === 0,
  );
  return (
    <ClassifiedEdition city={city} weekId={openWeek} emptyPaper={emptyPaper}>
      <div className="classified-columns" data-classified-columns="">
        {CATEGORIES.map((category) => (
          <LaneBoard
            key={category.slug}
            city={city}
            category={category}
            listings={paidLanes[category.slug]}
            lastWeek={lastWeek?.[category.slug]}
            weekId={openWeek}
          />
        ))}
      </div>
      {emptyPaper ? null : <ColumnIndex city={city} />}
      <ClaimColumn city={city.slug} emptyPaper={emptyPaper} />
    </ClassifiedEdition>
  );
}
