import { CATEGORIES, type CategorySlug } from "./categories";
import {
  getDb,
  type AppDb,
  type Listing,
  type TakedownReason,
} from "./db";
import { currentWeekId, previousWeekId } from "./week";

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

/**
 * Polar (or the fixture) has reported paid. Unpaid / abandoned checkout
 * never ranks and must not paint Call this #1.
 */
export function isPolarPaidListing(
  listing: Pick<Listing, "createdAt">,
): boolean {
  const paidAt = listing.createdAt?.trim() ?? "";
  if (!paidAt) return false;
  const ms = Date.parse(paidAt);
  return Number.isFinite(ms) && ms > 0;
}

/** Paid rows only. Unpaid or abandoned checkouts never take a rank. */
export function paidListings<T extends Pick<Listing, "createdAt">>(
  listings: readonly T[],
): T[] {
  return listings.filter(isPolarPaidListing);
}

export function rankLane(listings: readonly Listing[]): RankedListing[] {
  return paidListings(listings)
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

/**
 * Visible Polar-paid listings in one (city, category, weekId) lane.
 * Ranker stays keyed by city; weeks never mix. Clicks stay at the stored integer.
 * Unpaid checkout drafts never appear.
 */
export function listLane(
  city: string,
  category: CategorySlug,
  db: AppDb = getDb(),
  week: string = currentWeekId(),
): RankedListing[] {
  const rows = db
    .prepare<[string, string, string], ListingRow>(
      `SELECT id, business, category, city, site_url, license_id, bid_usd,
              week_id, created_at, raised_at, clicks, hidden, hidden_reason
         FROM listings
        WHERE city = ? AND category = ? AND week_id = ? AND hidden = 0
        ORDER BY bid_usd DESC, created_at ASC`,
    )
    .all(city, category, week);
  return rankLane(rows.map(listingFromRow));
}

export function listCityLanes(
  city: string,
  db: AppDb = getDb(),
  week: string = currentWeekId(),
): Record<CategorySlug, RankedListing[]> {
  return Object.fromEntries(
    CATEGORIES.map((category) => [
      category.slug,
      listLane(city, category.slug, db, week),
    ]),
  ) as Record<CategorySlug, RankedListing[]>;
}

/** Last week's #1 in this city × category, if anyone paid. Not current rank. */
export function lastWeekNumberOne(
  city: string,
  category: CategorySlug,
  db: AppDb = getDb(),
  now: Date = new Date(),
): RankedListing | undefined {
  const lastWeek = previousWeekId(currentWeekId(now));
  return listLane(city, category, db, lastWeek)[0];
}

export function listLastWeekChampions(
  city: string,
  db: AppDb = getDb(),
  now: Date = new Date(),
): Partial<Record<CategorySlug, RankedListing>> {
  const lastWeek = previousWeekId(currentWeekId(now));
  const out: Partial<Record<CategorySlug, RankedListing>> = {};
  for (const category of CATEGORIES) {
    const champion = listLane(city, category.slug, db, lastWeek)[0];
    if (champion) {
      out[category.slug] = champion;
    }
  }
  return out;
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
