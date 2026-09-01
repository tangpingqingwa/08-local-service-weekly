import { CATEGORIES } from "../categories";
import type { City } from "../cities";

type ColumnIndexProps = {
  city: City;
};

/** Occupied paper only: the four local service desks, after the listings. */
export function ColumnIndex({ city }: ColumnIndexProps) {
  return (
    <nav
      id="categories"
      className="column-index column-index-after"
      aria-label="Classified columns"
      data-category-tabs=""
      data-column-index-after=""
      data-slot="category-index"
    >
      <p className="column-index-label">Service desks</p>
      <div className="column-index-links">
        {CATEGORIES.map((category) => (
          <a
            key={category.slug}
            href={"/c/" + city.slug + "/" + category.slug}
            data-category={category.slug}
          >
            {category.display}
          </a>
        ))}
      </div>
    </nav>
  );
}
