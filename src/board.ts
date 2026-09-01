import { CATEGORIES, type CategorySlug } from "./categories";
import {
  getDb,
  type AppDb,
  type Listing,
  type TakedownReason,
} from "./db";
import {
  bidInRollingWeek,
  currentWeekId,
  nowUtc,
  previousWeekId,
  rollingWeekStart,
  rollingWeekEnd,
} from "./week";

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
 * Waffo (or the fixture) has reported paid. Unpaid / abandoned checkout
 * never ranks and must not paint Call this #1.
 */
export function isProviderPaidListing(
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
  return listings.filter(isProviderPaidListing);
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
 * Visible provider-paid listings in one (city, category) lane.
 * Live occupancy is rolling last 7 days from paid `createdAt`, not `week_id`.
 * Pass `week` to read a labeled archive copy. Ranker stays keyed by city.
 * Unpaid checkout drafts never appear.
 */
export function listLane(
  city: string,
  category: CategorySlug,
  db: AppDb = getDb(),
  week?: string,
  now: Date = nowUtc(),
): RankedListing[] {
  if (week) {
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
  const since = rollingWeekStart(now).toISOString();
  const until = rollingWeekEnd(now).toISOString();
  const rows = db
    .prepare<[string, string, string, string], ListingRow>(
      `SELECT id, business, category, city, site_url, license_id, bid_usd,
              week_id, created_at, raised_at, clicks, hidden, hidden_reason
         FROM listings
        WHERE city = ? AND category = ? AND hidden = 0
          AND created_at >= ? AND created_at <= ?
        ORDER BY bid_usd DESC, created_at ASC`,
    )
    .all(city, category, since, until);
  return rankLane(
    rows
      .map(listingFromRow)
      .filter((row) => bidInRollingWeek(row.createdAt, now)),
  );
}

export function listCityLanes(
  city: string,
  db: AppDb = getDb(),
  week?: string,
  now: Date = nowUtc(),
): Record<CategorySlug, RankedListing[]> {
  return Object.fromEntries(
    CATEGORIES.map((category) => [
      category.slug,
      listLane(city, category.slug, db, week, now),
    ]),
  ) as Record<CategorySlug, RankedListing[]>;
}

/** Last week's labeled #1 if they have aged out of the rolling window. Not current rank. */
export function lastWeekNumberOne(
  city: string,
  category: CategorySlug,
  db: AppDb = getDb(),
  now: Date = nowUtc(),
): RankedListing | undefined {
  const lastWeek = previousWeekId(currentWeekId(now));
  const [champion] = listLane(city, category, db, lastWeek, now);
  return champion && !bidInRollingWeek(champion.createdAt, now)
    ? champion
    : undefined;
}

export function listLastWeekChampions(
  city: string,
  db: AppDb = getDb(),
  now: Date = nowUtc(),
): Partial<Record<CategorySlug, RankedListing>> {
  const out: Partial<Record<CategorySlug, RankedListing>> = {};
  for (const category of CATEGORIES) {
    const champion = lastWeekNumberOne(city, category.slug, db, now);
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
