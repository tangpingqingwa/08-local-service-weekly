import { randomBytes } from "node:crypto";
import type { CategorySlug } from "../categories";
import { getDb, type AppDb, type Listing, type TakedownReason } from "../db";
import {
  applyRaise,
  findListingByIdentity,
} from "../listings";
import { requireClaimedLicense, TakedownError } from "../takedown";
import {
  currentWeekId,
  ensureWeek,
  requireOpenWeek,
  WeekError,
} from "../week";
import { LivePolarPort } from "./live";
import {
  isPolarLive,
  parseBidUsd,
  parseChargeUsd,
  PolarError,
  type CheckoutIntent,
  type CheckoutRecord,
  type CheckoutStart,
  type CreateCheckoutInput,
  type ListingDraft,
  type PolarPort,
} from "./port";

export { currentWeekId, ensureWeek } from "../week";

export type FakePolarOptions = {
  /** Default true: createCheckout returns paid and places the listing. */
  autoSettle?: boolean;
};

type CheckoutRow = {
  id: string;
  amount_usd: number;
  business: string;
  category: CategorySlug;
  city: string;
  site_url: string;
  license_id: string | null;
  week_id: string;
  status: CheckoutRecord["status"];
  listing_id: string | null;
  created_at: string;
  intent: CheckoutIntent;
  target_bid_usd: number | null;
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

let defaultPort: FakePolarPort | undefined;
let testOverride: PolarPort | undefined;

function newId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

function openWeekId(id: string): string {
  try {
    return requireOpenWeek(id);
  } catch (error) {
    if (error instanceof WeekError) {
      throw new PolarError(error.code, error.httpStatus, error.message);
    }
    throw error;
  }
}

export function placePaidListing(
  db: AppDb,
  draft: ListingDraft,
  paidAt: string,
): Listing {
  const bidUsd = parseBidUsd(draft.bidUsd);
  const weekId = openWeekId(draft.weekId ?? currentWeekId());
  ensureWeek(db, weekId);
  let licenseId: string | null;
  try {
    licenseId = requireClaimedLicense(draft.category, draft.licenseId);
  } catch (error) {
    if (error instanceof TakedownError) {
      throw new PolarError(error.code, error.httpStatus, error.message);
    }
    throw error;
  }
  const id = newId("lst");
  try {
    db.prepare(
      `INSERT INTO listings (
         id, business, category, city, site_url, license_id, bid_usd, week_id,
         created_at, raised_at, clicks, hidden, hidden_reason
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      draft.business,
      draft.category,
      draft.city,
      draft.siteUrl,
      licenseId,
      bidUsd,
      weekId,
      paidAt,
      null,
      0,
      0,
      null,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/UNIQUE/i.test(message)) {
      throw new PolarError("already_listed", 409);
    }
    throw error;
  }
  return {
    id,
    business: draft.business,
    category: draft.category,
    city: draft.city,
    siteUrl: draft.siteUrl,
    licenseId,
    bidUsd,
    weekId,
    createdAt: paidAt,
    raisedAt: null,
    clicks: 0,
    hidden: false,
    hiddenReason: null,
  };
}

function settlePaidRaise(
  db: AppDb,
  checkout: CheckoutRecord & { createdAt: string },
): Listing {
  const weekId = checkout.listing.weekId
    ? openWeekId(checkout.listing.weekId)
    : undefined;
  if (!weekId) {
    throw new PolarError("invalid_listing", 400, "Missing weekId");
  }
  const existing = findListingByIdentity(db, {
    siteUrl: checkout.listing.siteUrl,
    category: checkout.listing.category,
    city: checkout.listing.city,
    weekId,
  });
  if (!existing) {
    throw new PolarError("listing_not_found", 404);
  }
  return applyRaise(db, existing, {
    newBidUsd: checkout.listing.bidUsd,
    chargeUsd: checkout.amountUsd,
    business: checkout.listing.business,
    licenseId: checkout.listing.licenseId,
    raisedAt: checkout.createdAt,
  });
}

/** In-process Polar. Completing / auto-settling writes the listing; unpaid does not. */
export class FakePolarPort implements PolarPort {
  readonly kind = "fixture" as const;
  private readonly autoSettle: boolean;
  private seq = 0;

  constructor(
    private readonly db: AppDb = getDb(),
    options: FakePolarOptions = {},
  ) {
    this.autoSettle = options.autoSettle !== false;
  }

  database(): AppDb {
    return this.db;
  }

  reset(): void {
    this.db.exec("DELETE FROM checkouts");
    this.seq = 0;
  }

  async createCheckout(input: CreateCheckoutInput): Promise<CheckoutStart> {
    const intent: CheckoutIntent = input.intent ?? "place";
    const amountUsd =
      intent === "raise"
        ? parseChargeUsd(input.amountUsd)
        : parseBidUsd(input.amountUsd);
    const weekId = openWeekId(input.listing.weekId ?? currentWeekId());
    ensureWeek(this.db, weekId);
    const targetBidUsd =
      intent === "raise" ? parseBidUsd(input.listing.bidUsd) : amountUsd;
    const listing: ListingDraft = {
      ...input.listing,
      bidUsd: targetBidUsd,
      weekId,
    };
    const id = newId("chk");
    this.db
      .prepare(
        `INSERT INTO checkouts (
           id, amount_usd, business, category, city, site_url, license_id,
           week_id, status, listing_id, created_at, intent, target_bid_usd
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', NULL, ?, ?, ?)`,
      )
      .run(
        id,
        amountUsd,
        listing.business,
        listing.category,
        listing.city,
        listing.siteUrl,
        listing.licenseId,
        weekId,
        this.nextIso(),
        intent,
        targetBidUsd,
      );
    if (this.autoSettle) {
      const paid = await this.settle(id);
      return {
        id,
        status: "paid",
        url: `/return?checkout=${encodeURIComponent(id)}`,
        listingId: paid?.id,
      };
    }
    return {
      id,
      status: "open",
      url: `/return?checkout=${encodeURIComponent(id)}`,
    };
  }

  async settle(id: string): Promise<Listing | null> {
    const checkout = this.loadCheckout(id);
    if (!checkout || checkout.status === "cancelled") {
      return null;
    }
    if (checkout.status === "paid" && checkout.listingId) {
      return this.loadListing(checkout.listingId);
    }
    const listing =
      checkout.intent === "raise"
        ? settlePaidRaise(this.db, checkout)
        : placePaidListing(this.db, checkout.listing, checkout.createdAt);
    this.db
      .prepare(
        "UPDATE checkouts SET status = 'paid', listing_id = ? WHERE id = ?",
      )
      .run(listing.id, id);
    return listing;
  }

  async abandon(id: string): Promise<void> {
    const checkout = this.loadCheckout(id);
    if (!checkout || checkout.status !== "open") {
      return;
    }
    this.db
      .prepare("UPDATE checkouts SET status = 'cancelled' WHERE id = ?")
      .run(id);
  }

  getCheckout(id: string): CheckoutRecord | undefined {
    const checkout = this.loadCheckout(id);
    if (!checkout) {
      return undefined;
    }
    return {
      id: checkout.id,
      amountUsd: checkout.amountUsd,
      listing: { ...checkout.listing },
      status: checkout.status,
      listingId: checkout.listingId,
      intent: checkout.intent,
    };
  }

  private loadCheckout(
    id: string,
  ): (CheckoutRecord & { createdAt: string }) | undefined {
    const row = this.db
      .prepare<[string], CheckoutRow>(
        `SELECT id, amount_usd, business, category, city, site_url, license_id,
                week_id, status, listing_id, created_at, intent, target_bid_usd
           FROM checkouts WHERE id = ?`,
      )
      .get(id);
    if (!row) {
      return undefined;
    }
    return {
      id: row.id,
      amountUsd: row.amount_usd,
      listing: {
        business: row.business,
        category: row.category,
        city: row.city,
        siteUrl: row.site_url,
        licenseId: row.license_id,
        bidUsd: row.target_bid_usd ?? row.amount_usd,
        weekId: row.week_id,
      },
      status: row.status,
      listingId: row.listing_id ?? undefined,
      intent: row.intent,
      createdAt: row.created_at,
    };
  }

  private loadListing(id: string): Listing | null {
    const row = this.db
      .prepare<[string], ListingRow>(
        `SELECT id, business, category, city, site_url, license_id, bid_usd,
                week_id, created_at, raised_at, clicks, hidden, hidden_reason
           FROM listings WHERE id = ?`,
      )
      .get(id);
    return row ? listingFromRow(row) : null;
  }

  private nextIso(): string {
    this.seq += 1;
    return new Date(Date.now() + this.seq).toISOString();
  }
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

export function getFakePolarPort(db?: AppDb): FakePolarPort {
  if (db) {
    return new FakePolarPort(db);
  }
  if (!defaultPort) {
    defaultPort = new FakePolarPort(getDb());
  }
  return defaultPort;
}

/** Fixture unless POLAR_LIVE=1. POLAR_FIXTURE_ONLY=1 always wins. */
export function getPolarPort(db?: AppDb): PolarPort {
  if (testOverride) {
    return testOverride;
  }
  if (isPolarLive()) {
    return new LivePolarPort({ db: db ?? getDb() });
  }
  return getFakePolarPort(db);
}

export function setPolarPortForTests(port?: PolarPort): void {
  testOverride = port;
}

export function resetPolarFixture(): void {
  defaultPort?.reset();
  defaultPort = undefined;
  testOverride = undefined;
}
