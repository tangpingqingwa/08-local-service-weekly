import type { RankedListing } from "../board";
import { CATEGORIES, type CategorySlug } from "../categories";
import type { City } from "../cities";
import { LaneBoard } from "./lane-board";
import { OutbidForm } from "./outbid-form";

type CityHubProps = {
  city: City;
  lanes: Readonly<Record<CategorySlug, readonly RankedListing[]>>;
};

export function CityHub({ city, lanes }: CityHubProps) {
  return (
    <main className="board" data-board="" data-city={city.slug}>
      <header className="board-header">
        <p className="eyebrow">Local Service Weekly</p>
        <h1>{city.display}</h1>
        <p>
          The #1 mover, dentist, immigration lawyer, or tutor in town is
          whoever paid the most this week. Rank is the bid.
        </p>
      </header>
      <nav className="category-tabs" aria-label="Categories" data-category-tabs="">
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
      {CATEGORIES.map((category) => (
        <LaneBoard
          key={category.slug}
          city={city}
          category={category}
          listings={lanes[category.slug]}
        />
      ))}
      <OutbidForm city={city.slug} lockCity />
    </main>
  );
}
