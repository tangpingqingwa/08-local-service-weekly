import { CATEGORIES } from "../categories";
import type { City } from "../cities";

type ColumnIndexProps = {
  city: City;
};

/** Occupied paper only: four-tab column pick after the listing, not in the masthead. */
export function ColumnIndex({ city }: ColumnIndexProps) {
  return (
    <nav
      className="column-index column-index-after"
      aria-label="Classified columns"
      data-category-tabs=""
      data-column-index-after=""
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
  );
}
