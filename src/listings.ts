import { getDb, type AppDb, type Listing, type TakedownReason } from "./db";
import type { CategorySlug } from "./categories";
import { MAX_BID_USD } from "./constants";
import {
  parseBidUsd,
  PolarError,
  type ListingDraft,
  type PolarPort,
} from "./polar/port";
import { canonicalizeSiteUrl, UrlError } from "./urls";

function dbFromPort(port: PolarPort, fallback: AppDb): AppDb {
  if (typeof port.database === "function") {
    return port.database();
  }
  return fallback;
}

export type ListingIdentity = {
  siteUrl: string;
  category: CategorySlug;
  city: string;
  weekId: string;
};

export type RaiseQuote = {
  currentBidUsd: number;
  newBidUsd: number;
  chargeUsd: number;
};

export type RaiseResult = {
  checkoutId: string;
  status: string;
  url: string;
  listing: Listing | undefined;
  quote: RaiseQuote;
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

const LISTING_COLUMNS = `id, business, category, city, site_url, license_id, bid_usd,
        week_id, created_at, raised_at, clicks, hidden, hidden_reason`;

/** Identity key: canonical site URL + category + city + weekId. */
export function listingIdentity(input: ListingIdentity): ListingIdentity {
  try {
    return {
      siteUrl: canonicalizeSiteUrl(input.siteUrl),
      category: input.category,
      city: input.city,
      weekId: input.weekId,
    };
  } catch (error) {
    if (error instanceof UrlError) {
      throw new PolarError(error.code, error.httpStatus, error.message);
    }
    throw error;
  }
}

export function listingFromRow(row: ListingRow): Listing {
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

export function findListingByIdentity(
  db: AppDb,
  identity: ListingIdentity,
): Listing | undefined {
  const key = listingIdentity(identity);
  const row = db
    .prepare<[string, string, string, string], ListingRow>(
      `SELECT ${LISTING_COLUMNS}
         FROM listings
        WHERE site_url = ? AND category = ? AND city = ? AND week_id = ?`,
    )
    .get(key.siteUrl, key.category, key.city, key.weekId);
  return row ? listingFromRow(row) : undefined;
}

export function getListingById(db: AppDb, id: string): Listing | undefined {
  const row = db
    .prepare<[string], ListingRow>(
      `SELECT ${LISTING_COLUMNS} FROM listings WHERE id = ?`,
    )
    .get(id);
  return row ? listingFromRow(row) : undefined;
}

/**
 * SPEC §5.6: raise to N charges N − current only.
 * Require N >= current + 1 and N <= 999999. createdAt is not touched here.
 */
export function quoteRaise(
  existing: Pick<Listing, "bidUsd" | "hidden">,
  newBidUsd: number,
): RaiseQuote {
  if (existing.hidden) {
    throw new PolarError("listing_hidden", 409);
  }
  const target = parseBidUsd(newBidUsd);
  if (target < existing.bidUsd + 1) {
    throw new PolarError("bid_too_low", 400);
  }
  if (target > MAX_BID_USD) {
    throw new PolarError("bid_too_high", 400);
  }
  return {
    currentBidUsd: existing.bidUsd,
    newBidUsd: target,
    chargeUsd: target - existing.bidUsd,
  };
}

export function applyRaise(
  db: AppDb,
  existing: Listing,
  input: {
    newBidUsd: number;
    chargeUsd: number;
    business?: string;
    licenseId?: string | null;
    raisedAt: string;
  },
): Listing {
  if (existing.hidden) {
    throw new PolarError("listing_hidden", 409);
  }
  const quote = quoteRaise(existing, input.newBidUsd);
  if (input.chargeUsd !== quote.chargeUsd) {
    throw new PolarError("bid_too_low", 400);
  }
  const business = input.business?.trim() || existing.business;
  const licenseId =
    input.licenseId === undefined ? existing.licenseId : input.licenseId;
  db.prepare(
    `UPDATE listings
        SET business = ?,
            license_id = ?,
            bid_usd = ?,
            raised_at = ?
      WHERE id = ? AND created_at = ?`,
  ).run(
    business,
    licenseId,
    quote.newBidUsd,
    input.raisedAt,
    existing.id,
    existing.createdAt,
  );
  return {
    ...existing,
    business,
    licenseId,
    bidUsd: quote.newBidUsd,
    raisedAt: input.raisedAt,
  };
}

/** Same identity, pay the difference via Polar/fixture. */
export async function raiseListing(
  draft: ListingDraft,
  port: PolarPort,
  db?: AppDb,
): Promise<RaiseResult> {
  const store = db ?? dbFromPort(port, getDb());
  const weekId = draft.weekId;
  if (!weekId) {
    throw new PolarError("invalid_listing", 400, "Missing weekId");
  }
  const existing = findListingByIdentity(store, {
    siteUrl: draft.siteUrl,
    category: draft.category,
    city: draft.city,
    weekId,
  });
  if (!existing) {
    throw new PolarError("listing_not_found", 404);
  }
  const quote = quoteRaise(existing, draft.bidUsd);
  const started = await port.createCheckout({
    amountUsd: quote.chargeUsd,
    listing: {
      ...draft,
      bidUsd: quote.newBidUsd,
      weekId,
    },
    intent: "raise",
  });
  const listing = started.listingId
    ? getListingById(store, started.listingId)
    : findListingByIdentity(store, {
        siteUrl: draft.siteUrl,
        category: draft.category,
        city: draft.city,
        weekId,
      });
  return {
    checkoutId: started.id,
    status: started.status,
    url: started.url,
    listing,
    quote,
  };
}
