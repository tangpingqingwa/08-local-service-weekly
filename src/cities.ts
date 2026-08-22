export type BoardLookup<T> =
  | { ok: true; value: T }
  | { ok: false; code: "city_unknown" | "category_unknown"; status: 404 };

export type City = {
  slug: string;
  display: string;
  public: boolean;
};

/** Catalog. v1 public list is London; rank code takes city as a string key. */
export const CITIES: readonly City[] = [
  { slug: "london", display: "London", public: true },
];

export const PUBLIC_CITY_SLUGS: readonly string[] = CITIES.filter(
  (city) => city.public,
).map((city) => city.slug);

export function getCity(slug: string): City | undefined {
  return CITIES.find((city) => city.slug === slug);
}

export function resolveCity(slug: string): BoardLookup<City> {
  const city = getCity(slug);
  if (!city) {
    return { ok: false, code: "city_unknown", status: 404 };
  }
  return { ok: true, value: city };
}
