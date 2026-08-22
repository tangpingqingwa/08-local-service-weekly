import type { BoardLookup } from "./cities";

/** SPEC §3 / §4 */
export type CategorySlug =
  | "movers"
  | "dentists"
  | "immigration_lawyers"
  | "tutors";

export type Category = {
  slug: CategorySlug;
  display: string;
  licenseRequired: boolean;
};

/** Closed set in v1. Unknown slug → 404 category_unknown. */
export const CATEGORIES: readonly Category[] = [
  { slug: "movers", display: "Movers", licenseRequired: false },
  { slug: "dentists", display: "Dentists", licenseRequired: true },
  { slug: "immigration_lawyers", display: "Immigration lawyers", licenseRequired: true },
  { slug: "tutors", display: "Tutors", licenseRequired: false },
];

export const CATEGORY_SLUGS: readonly CategorySlug[] = CATEGORIES.map(
  (category) => category.slug,
);

export function getCategory(slug: string): Category | undefined {
  return CATEGORIES.find((category) => category.slug === slug);
}

export function resolveCategory(slug: string): BoardLookup<Category> {
  const category = getCategory(slug);
  if (!category) {
    return { ok: false, code: "category_unknown", status: 404 };
  }
  return { ok: true, value: category };
}

export function categoryRequiresLicense(slug: CategorySlug): boolean {
  return getCategory(slug)?.licenseRequired === true;
}
