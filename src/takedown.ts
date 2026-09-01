import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  categoryRequiresLicense,
  getCategory,
  type CategorySlug,
} from "./categories";
import { getCity } from "./cities";
import {
  getDb,
  type AppDb,
  type Listing,
  type TakedownReason,
} from "./db";

/** SPEC §10 — claimed license only. Never a verification status. */
export const LICENSE_MIN_VISIBLE = 2;
export const LICENSE_MAX_VISIBLE = 64;

export const TAKEDOWN_REASONS: readonly TakedownReason[] = [
  "unlicensed",
  "impersonation",
  "complaint",
  "nsfw",
  "chat_link",
  "other",
];

export type TakedownErrorCode =
  | "license_required"
  | "listing_not_found"
  | "invalid_takedown"
  | "invalid_complaint"
  | "operator_unauthorized";

export class TakedownError extends Error {
  constructor(
    readonly code: TakedownErrorCode,
    readonly httpStatus: number,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "TakedownError";
  }
}

export type HideListingInput = {
  listingId: string;
  reason: TakedownReason;
  /** Required when reason is `complaint`. Must name listing + city + category. */
  complaint?: string | null;
};

export type TakedownRecord = {
  id: string;
  listingId: string;
  reason: TakedownReason;
  complaint: string | null;
  createdAt: string;
};

export type OperatorHideInput = HideListingInput & {
  secret?: string | null;
};

/** Visible claimed characters only. v1 does not call a license registry. */
export function requireClaimedLicense(
  category: CategorySlug,
  licenseId: string | null,
): string | null {
  if (!categoryRequiresLicense(category)) {
    return licenseId;
  }
  const claimed = licenseId?.trim() ?? "";
  if (
    claimed.length < LICENSE_MIN_VISIBLE ||
    claimed.length > LICENSE_MAX_VISIBLE
  ) {
    throw new TakedownError("license_required", 400);
  }
  if (/[\u0000-\u001F\u007F]/.test(claimed)) {
    throw new TakedownError("license_required", 400);
  }
  return claimed;
}

export function parseTakedownReason(raw: unknown): TakedownReason {
  if (typeof raw !== "string") {
    throw new TakedownError("invalid_takedown", 400);
  }
  const reason = raw.trim() as TakedownReason;
  if (!TAKEDOWN_REASONS.includes(reason)) {
    throw new TakedownError("invalid_takedown", 400);
  }
  return reason;
}

function fold(text: string): string {
  return text.trim().toLowerCase();
}

function complaintNamesListing(
  complaint: string,
  listing: Listing,
): boolean {
  const body = fold(complaint);
  if (body.length < 1) {
    return false;
  }
  const cityDisplay = getCity(listing.city)?.display ?? listing.city;
  const categoryDisplay =
    getCategory(listing.category)?.display ?? listing.category;
  const namesListing =
    body.includes(fold(listing.id)) || body.includes(fold(listing.business));
  const namesCity =
    body.includes(fold(listing.city)) || body.includes(fold(cityDisplay));
  const namesCategory =
    body.includes(fold(listing.category)) ||
    body.includes(fold(categoryDisplay));
  return namesListing && namesCity && namesCategory;
}

function requireComplaint(listing: Listing, complaint: string | null): string {
  if (complaint === null || complaint.trim() === "") {
    throw new TakedownError("invalid_complaint", 400);
  }
  if (!complaintNamesListing(complaint, listing)) {
    throw new TakedownError("invalid_complaint", 400);
  }
  return complaint.trim();
}

function newTakedownId(): string {
  return `tdn_${randomBytes(8).toString("hex")}`;
}

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

function loadListing(db: AppDb, id: string): Listing | undefined {
  const row = db
    .prepare<[string], ListingRow>(
      `SELECT id, business, category, city, site_url, license_id, bid_usd,
              week_id, created_at, raised_at, clicks, hidden, hidden_reason
         FROM listings WHERE id = ?`,
    )
    .get(id);
  return row ? listingFromRow(row) : undefined;
}

/**
 * Hide a listing and vacate its rank. Bid is not refunded.
 * Does not insert a replacement #1.
 */
export function hideListing(
  db: AppDb,
  input: HideListingInput,
  now: Date = new Date(),
): Listing {
  const listing = loadListing(db, input.listingId);
  if (!listing) {
    throw new TakedownError("listing_not_found", 404);
  }
  const reason = parseTakedownReason(input.reason);
  const complaint =
    reason === "complaint"
      ? requireComplaint(listing, input.complaint ?? null)
      : input.complaint?.trim()
        ? input.complaint.trim()
        : null;

  const commitTakedown = db.transaction(() => {
    db.prepare(
      `UPDATE listings
          SET hidden = 1,
              hidden_reason = ?
        WHERE id = ?`,
    ).run(reason, listing.id);
    db.prepare(
      `INSERT INTO takedowns (id, listing_id, reason, complaint, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(newTakedownId(), listing.id, reason, complaint, now.toISOString());
  });
  commitTakedown();

  return {
    ...listing,
    hidden: true,
    hiddenReason: reason,
  };
}

/** Operator unhide. Hidden listings cannot raise until this runs. */
export function unhideListing(db: AppDb, listingId: string): Listing {
  const listing = loadListing(db, listingId);
  if (!listing) {
    throw new TakedownError("listing_not_found", 404);
  }
  db.prepare(
    `UPDATE listings
        SET hidden = 0,
            hidden_reason = NULL
      WHERE id = ?`,
  ).run(listing.id);
  return {
    ...listing,
    hidden: false,
    hiddenReason: null,
  };
}

export function listTakedowns(db: AppDb, listingId: string): TakedownRecord[] {
  return db
    .prepare<
      [string],
      {
        id: string;
        listing_id: string;
        reason: TakedownReason;
        complaint: string | null;
        created_at: string;
      }
    >(
      `SELECT id, listing_id, reason, complaint, created_at
         FROM takedowns
        WHERE listing_id = ?
        ORDER BY created_at ASC`,
    )
    .all(listingId)
    .map((row) => ({
      id: row.id,
      listingId: row.listing_id,
      reason: row.reason,
      complaint: row.complaint,
      createdAt: row.created_at,
    }));
}

export type OperatorEnv = Record<string, string | undefined>;

/** Shared operator secret. Missing or wrong secret fails closed. */
export function requireOperatorSecret(
  provided: string | null | undefined,
  env: OperatorEnv = process.env,
): void {
  const expected = env.OPERATOR_SECRET;
  if (!expected || expected.length < 8) {
    throw new TakedownError("operator_unauthorized", 401);
  }
  if (typeof provided !== "string" || provided.length !== expected.length) {
    throw new TakedownError("operator_unauthorized", 401);
  }
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    throw new TakedownError("operator_unauthorized", 401);
  }
}

export function operatorHideListing(
  input: OperatorHideInput,
  db: AppDb = getDb(),
  env: OperatorEnv = process.env,
): Listing {
  requireOperatorSecret(input.secret, env);
  return hideListing(db, input);
}

export function operatorUnhideListing(
  listingId: string,
  secret: string | null | undefined,
  db: AppDb = getDb(),
  env: OperatorEnv = process.env,
): Listing {
  requireOperatorSecret(secret, env);
  return unhideListing(db, listingId);
}
