import type { RankedListing } from "../board";
import { CATEGORIES, type CategorySlug } from "../categories";
import type { City } from "../cities";
import { currentWeekId } from "../week";
import { ClassifiedEdition } from "./edition";
import { LaneBoard } from "./lane-board";
import { OutbidForm } from "./outbid-form";

type CityHubProps = {
  city: City;
  lanes: Readonly<Record<CategorySlug, readonly RankedListing[]>>;
  lastWeek?: Readonly<Partial<Record<CategorySlug, RankedListing>>>;
  weekId?: string;
};

export function CityHub({ city, lanes, lastWeek, weekId }: CityHubProps) {
  const openWeek = weekId ?? currentWeekId();
  return (
    <ClassifiedEdition
      city={city}
      weekId={openWeek}
      claim={<OutbidForm city={city.slug} lockCity />}
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
    </ClassifiedEdition>
  );
}
