import { getDb, type AppDb, type Listing } from "../db";
import { getListingById } from "../listings";
import { requireClaimedLicense, TakedownError } from "../takedown";
import {
  currentWeekId,
  ensureWeek,
  requireOpenWeek,
  WeekError,
} from "../week";
import {
  isPolarLive,
  parseBidUsd,
  parseChargeUsd,
  polarFixtureOnly,
  PolarError,
  type CheckoutIntent,
  type CheckoutRecord,
  type CheckoutStart,
  type CreateCheckoutInput,
  type ListingDraft,
  type PolarEnv,
  type PolarPort,
} from "./port";

/** Only used when POLAR_LIVE=1. tests/ and CI never fetch this host. */
export const POLAR_API_BASE = "https://api.polar.sh";

export type LivePolarOptions = {
  env?: PolarEnv;
  fetch?: typeof fetch;
  db?: AppDb;
};

type CheckoutRow = {
  id: string;
  amount_usd: number;
  business: string;
  category: ListingDraft["category"];
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

export function polarAccessToken(env: PolarEnv = process.env): string | undefined {
  const token = env.POLAR_ACCESS_TOKEN?.trim();
  return token ? token : undefined;
}

export function requirePolarAccessToken(env: PolarEnv = process.env): string {
  const token = polarAccessToken(env);
  if (!token) {
    throw new Error("BLOCKED-SECRET: POLAR_ACCESS_TOKEN");
  }
  return token;
}

function publicBaseUrl(env: PolarEnv): string {
  const fromSuccess = env.POLAR_SUCCESS_URL?.trim();
  if (fromSuccess) {
    return fromSuccess.replace(/\/return.*$/i, "").replace(/\/$/, "");
  }
  const fromPublic = env.PUBLIC_BASE_URL?.trim();
  if (fromPublic) {
    return fromPublic.replace(/\/$/, "");
  }
  return "http://127.0.0.1:3000";
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

function claimedLicense(
  category: ListingDraft["category"],
  licenseId: string | null,
): string | null {
  try {
    return requireClaimedLicense(category, licenseId);
  } catch (error) {
    if (error instanceof TakedownError) {
      throw new PolarError(error.code, error.httpStatus, error.message);
    }
    throw error;
  }
}

/**
 * Live Polar Checkout. Selected only when POLAR_LIVE=1 and
 * POLAR_FIXTURE_ONLY is not 1. Constructor does not fetch Polar.
 */
export class LivePolarPort implements PolarPort {
  readonly kind = "live" as const;
  private readonly env: PolarEnv;
  private readonly fetchFn: typeof fetch;
  private readonly db: AppDb;

  constructor(options: LivePolarOptions = {}) {
    this.env = options.env ?? process.env;
    this.fetchFn = options.fetch ?? fetch;
    this.db = options.db ?? getDb();
    if (polarFixtureOnly(this.env) || !isPolarLive(this.env)) {
      throw new PolarError("polar_not_live", 503);
    }
    requirePolarAccessToken(this.env);
  }

  database(): AppDb {
    return this.db;
  }

  async createCheckout(input: CreateCheckoutInput): Promise<CheckoutStart> {
    if (polarFixtureOnly(this.env) || !isPolarLive(this.env)) {
      throw new PolarError("polar_not_live", 503);
    }
    const token = requirePolarAccessToken(this.env);
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
      licenseId: claimedLicense(input.listing.category, input.listing.licenseId),
      bidUsd: targetBidUsd,
      weekId,
    };

    let response: Response;
    try {
      response = await this.fetchFn(`${POLAR_API_BASE}/v1/checkouts/`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(polarCheckoutBody(this.env, amountUsd, listing, intent)),
      });
    } catch {
      throw new PolarError("polar_not_live", 503, "polar_unavailable");
    }
    if (!response.ok) {
      throw new PolarError("polar_not_live", 503, "polar_unavailable");
    }
    const payload = (await response.json()) as Record<string, unknown>;
    const id = readString(payload.id);
    const url = readString(payload.url);
    if (!id || !url) {
      throw new PolarError("polar_not_live", 503, "polar_unavailable");
    }

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
        new Date().toISOString(),
        intent,
        targetBidUsd,
      );

    return { id, status: "open", url };
  }

  async settle(id: string): Promise<Listing | null> {
    const checkout = this.loadCheckout(id);
    if (!checkout || checkout.status !== "paid" || !checkout.listingId) {
      return null;
    }
    return getListingById(this.db, checkout.listingId) ?? null;
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
}

function polarCheckoutBody(
  env: PolarEnv,
  amountUsd: number,
  listing: ListingDraft,
  intent: CheckoutIntent,
): Record<string, unknown> {
  const successUrl = `${publicBaseUrl(env)}/return?checkout={CHECKOUT_ID}`;
  const body: Record<string, unknown> = {
    amount: amountUsd * 100,
    currency: "usd",
    success_url: successUrl,
    metadata: {
      business: listing.business,
      category: listing.category,
      city: listing.city,
      siteUrl: listing.siteUrl,
      licenseId: listing.licenseId ?? "",
      bidUsd: String(listing.bidUsd),
      weekId: listing.weekId ?? "",
      intent,
      amountUsd: String(amountUsd),
    },
  };
  const productId = env.POLAR_PRODUCT_ID?.trim();
  if (productId) {
    body.product_id = productId;
  }
  return body;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}
