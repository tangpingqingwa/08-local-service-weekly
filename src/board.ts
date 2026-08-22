import { CATEGORIES, type CategorySlug } from "./categories";
import {
  getDb,
  type AppDb,
  type Listing,
  type TakedownReason,
} from "./db";

export { DEFAULT_CITY_SLUG, MAX_BID_USD, MIN_BID_USD } from "./constants";
export { resolveCategory } from "./categories";
export { resolveCity } from "./cities";
export type { BoardLookup } from "./cities";

export type RankedListing = Listing & {
  rank: number;
  siteHost: string;
};

type ListingRow = {
  id: string;
  business: string;
  category: CategorySlug;
  city: string;
  site_url: string;
  license_id: string | null;
  bid_usd: number;
  week_id: string;
  created_at: string;
  raised_at: string | null;
  clicks: number;
  hidden: number;
  hidden_reason: TakedownReason | null;
};

export function siteHost(siteUrl: string): string {
  try {
    return new URL(siteUrl).host;
  } catch {
    return siteUrl;
  }
}

export function rankLane(listings: readonly Listing[]): RankedListing[] {
  return listings
    .filter((listing) => !listing.hidden)
    .slice()
    .sort((a, b) => {
      if (b.bidUsd !== a.bidUsd) return b.bidUsd - a.bidUsd;
      if (a.createdAt < b.createdAt) return -1;
      if (a.createdAt > b.createdAt) return 1;
      return 0;
    })
    .map((listing, index) => ({
      ...listing,
      rank: index + 1,
      siteHost: siteHost(listing.siteUrl),
    }));
}

/** Visible listings in one city × category. Clicks stay at the stored integer. */
export function listLane(
  city: string,
  category: CategorySlug,
  db: AppDb = getDb(),
): RankedListing[] {
  const rows = db
    .prepare<[string, string], ListingRow>(
      `SELECT id, business, category, city, site_url, license_id, bid_usd,
              week_id, created_at, raised_at, clicks, hidden, hidden_reason
         FROM listings
        WHERE city = ? AND category = ? AND hidden = 0
        ORDER BY bid_usd DESC, created_at ASC`,
    )
    .all(city, category);
  return rankLane(rows.map(listingFromRow));
}

export function listCityLanes(
  city: string,
  db: AppDb = getDb(),
): Record<CategorySlug, RankedListing[]> {
  return Object.fromEntries(
    CATEGORIES.map((category) => [
      category.slug,
      listLane(city, category.slug, db),
    ]),
  ) as Record<CategorySlug, RankedListing[]>;
}

function listingFromRow(row: ListingRow): Listing {
  return {
    id: row.id,
    business: row.business,
    category: row.category,
    city: row.city,
    siteUrl: row.site_url,
    licenseId: row.license_id,
    bidUsd: row.bid_usd,
    weekId: row.week_id,
    createdAt: row.created_at,
    raisedAt: row.raised_at,
    clicks: row.clicks,
    hidden: row.hidden === 1,
    hiddenReason: row.hidden_reason,
  };
}
