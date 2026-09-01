import { rankLane, type RankedListing } from "../board";
import { CATEGORIES, type CategorySlug } from "../categories";
import type { City } from "../cities";
import { currentWeekId } from "../week";
import { ClaimColumn } from "./claim-column";
import { ColumnIndex } from "./column-index";
import { ClassifiedEdition } from "./edition";
import { LaneBoard } from "./lane-board";
import { OutbidForm } from "./outbid-form";

type CityHubProps = {
  city: City;
  lanes: Readonly<Record<CategorySlug, readonly RankedListing[]>>;
  lastWeek?: Readonly<Partial<Record<CategorySlug, RankedListing>>>;
  weekId?: string;
};

/**
 * The home paper has one ordinary composition for every dataset. A fixture
 * payment store may seed these lanes, but it never selects a reference
 * renderer or substitutes another product's content.
 */
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
  const firstOccupied = CATEGORIES.find(
    (category) => paidLanes[category.slug].length > 0,
  );
  const firstLead = firstOccupied
    ? paidLanes[firstOccupied.slug][0]
    : undefined;

  const paperClaim = emptyPaper ? (
    <OutbidForm
      city={city.slug}
      lockCity
      emptyPaper
      hero
    />
  ) : undefined;

  return (
    <ClassifiedEdition
      city={city}
      weekId={openWeek}
      emptyPaper={emptyPaper}
      claim={paperClaim}
    >
      {!emptyPaper ? (
        <OutbidForm
          city={city.slug}
          category={firstOccupied?.slug}
          lockCity
          emptyPaper={false}
          topBidUsd={firstLead?.bidUsd}
        />
      ) : null}

      <div
        className="classified-columns"
        data-classified-columns=""
        data-slot="lane-collection"
      >
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

      {!emptyPaper ? (
        <ColumnIndex city={city} />
      ) : null}

      <ClaimColumn city={city.slug} emptyPaper={emptyPaper} visualOnly />
    </ClassifiedEdition>
  );
}
