import { resolveCategory, type CategorySlug } from "../categories";
import { resolveCity } from "../cities";
import { MAX_BID_USD, MIN_BID_USD } from "../constants";
import type { Listing } from "../db";

export type PolarEnv = Record<string, string | undefined>;

export type ListingDraft = {
  business: string;
  category: CategorySlug;
  city: string;
  siteUrl: string;
  licenseId: string | null;
  bidUsd: number;
  weekId?: string;
};

export type CheckoutStatus = "open" | "paid" | "cancelled";

export type CheckoutRecord = {
  id: string;
  amountUsd: number;
  listing: ListingDraft;
  status: CheckoutStatus;
  listingId?: string;
};

export type CreateCheckoutInput = {
  amountUsd: number;
  listing: ListingDraft;
};

export type CheckoutStart = {
  id: string;
  status: CheckoutStatus;
  url: string;
  listingId?: string;
};

/** SPEC §8 / BUILD PolarPort. Fake settles in-process. */
export type PolarPort = {
  readonly kind: "fixture" | "live";
  createCheckout(input: CreateCheckoutInput): Promise<CheckoutStart>;
  settle(id: string): Promise<Listing | null>;
  getCheckout(id: string): CheckoutRecord | undefined;
  abandon(id: string): Promise<void>;
};

export type ReturnState = "paid" | "cancelled" | "unknown";

export class PolarError extends Error {
  constructor(
    readonly code: string,
    readonly httpStatus: number,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "PolarError";
  }
}

/** Live Polar only when POLAR_LIVE=1. POLAR_FIXTURE_ONLY=1 always wins. */
export function isPolarLive(env: PolarEnv = process.env): boolean {
  if (env.POLAR_FIXTURE_ONLY === "1") {
    return false;
  }
  return env.POLAR_LIVE === "1";
}

export function polarFixtureOnly(env: PolarEnv = process.env): boolean {
  return env.POLAR_FIXTURE_ONLY === "1";
}

export function parseBidUsd(raw: unknown): number {
  if (typeof raw === "boolean") {
    throw new PolarError("bid_not_integer", 400);
  }
  if (typeof raw === "number") {
    if (!Number.isInteger(raw)) {
      throw new PolarError("bid_not_integer", 400);
    }
    return assertBidRange(raw);
  }
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new PolarError("bid_not_integer", 400);
  }
  const trimmed = raw.trim().replace(/^\$/, "");
  if (!/^[0-9]+$/.test(trimmed)) {
    throw new PolarError("bid_not_integer", 400);
  }
  return assertBidRange(Number(trimmed));
}

function assertBidRange(value: number): number {
  if (value < MIN_BID_USD) {
    throw new PolarError("bid_too_low", 400);
  }
  if (value > MAX_BID_USD) {
    throw new PolarError("bid_too_high", 400);
  }
  return value;
}

export function parseListingDraft(
  input: Record<string, unknown>,
): ListingDraft {
  const business = readBusiness(input.business);
  const cityLookup = resolveCity(readRequired(input.city, "city"));
  if (!cityLookup.ok) {
    throw new PolarError(cityLookup.code, cityLookup.status);
  }
  const categoryLookup = resolveCategory(
    readRequired(input.category, "category"),
  );
  if (!categoryLookup.ok) {
    throw new PolarError(categoryLookup.code, categoryLookup.status);
  }
  const siteUrl = readSiteUrl(input.siteUrl ?? input.site);
  const licenseId = readOptionalText(input.licenseId);
  const bidUsd = parseBidUsd(input.amount ?? input.amountUsd ?? input.bidUsd);
  return {
    business,
    category: categoryLookup.value.slug,
    city: cityLookup.value.slug,
    siteUrl,
    licenseId,
    bidUsd,
  };
}

function readRequired(raw: unknown, field: string): string {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new PolarError("invalid_listing", 400, `Missing ${field}`);
  }
  return raw.trim();
}

function readBusiness(raw: unknown): string {
  const text = readRequired(raw, "business");
  if (text.length > 80) {
    throw new PolarError(
      "invalid_listing",
      400,
      "Business must be 1–80 characters",
    );
  }
  return text;
}

function readSiteUrl(raw: unknown): string {
  const text = readRequired(raw, "siteUrl");
  try {
    const url = new URL(text);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("not http(s)");
    }
  } catch {
    throw new PolarError("invalid_listing", 400, "Site URL must be http(s)");
  }
  return text;
}

function readOptionalText(raw: unknown): string | null {
  if (typeof raw !== "string") {
    return null;
  }
  const text = raw.trim();
  return text === "" ? null : text;
}

export function firstQuery(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export async function handleCheckoutReturn(
  params: {
    checkout?: string | string[];
    checkoutId?: string | string[];
    status?: string | string[];
  },
  port: PolarPort,
): Promise<{ state: ReturnState; listing: Listing | null }> {
  const checkoutId =
    firstQuery(params.checkout) ?? firstQuery(params.checkoutId);
  const rawStatus = (firstQuery(params.status) ?? "").toLowerCase();
  const canceled =
    rawStatus === "cancel" ||
    rawStatus === "canceled" ||
    rawStatus === "cancelled";

  if (canceled) {
    if (checkoutId) {
      await port.abandon(checkoutId);
    }
    return { state: "cancelled", listing: null };
  }

  if (!checkoutId) {
    return { state: "unknown", listing: null };
  }

  const existing = port.getCheckout(checkoutId);
  if (!existing) {
    return { state: "unknown", listing: null };
  }
  if (existing.status === "cancelled") {
    return { state: "cancelled", listing: null };
  }

  const listing = await port.settle(checkoutId);
  if (!listing) {
    const rec = port.getCheckout(checkoutId);
    if (rec?.status === "cancelled") {
      return { state: "cancelled", listing: null };
    }
    return { state: "unknown", listing: null };
  }
  return { state: "paid", listing };
}
