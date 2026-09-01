import type { CategorySlug } from "../categories";
import { resolveCategory } from "../categories";
import { resolveCity } from "../cities";
import type { AppDb, Listing } from "../db";
import { requireClaimedLicense, TakedownError } from "../takedown";
import { canonicalizeSiteUrl, UrlError } from "../urls";
import { currentWeekId } from "../week";
import { MAX_BID_USD, MIN_BID_USD } from "../constants";

export type PaymentEnv = Record<string, string | undefined>;

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

/** Provider checkout state shared by fixture and Waffo. */
export type ProviderCheckoutState = "pending" | "attached" | "unknown" | "failed";

export type CheckoutIntent = "place" | "raise";

export type CheckoutRecord = {
  id: string;
  amountUsd: number;
  listing: ListingDraft;
  status: CheckoutStatus;
  listingId?: string;
  intent: CheckoutIntent;
  providerCheckoutId?: string;
  providerProductId?: string;
  currency?: string;
  providerState?: ProviderCheckoutState;
};

export type CreateCheckoutInput = {
  amountUsd: number;
  listing: ListingDraft;
  intent?: CheckoutIntent;
};

export type CheckoutStart = {
  id: string;
  status: CheckoutStatus;
  url: string;
  listingId?: string;
  providerCheckoutId?: string;
};

/** Provider-neutral payment port shared by fixture and Waffo. */
export type PaymentPort = {
  readonly kind: "fixture" | "live";
  createCheckout(input: CreateCheckoutInput): Promise<CheckoutStart>;
  settle(id: string): Promise<Listing | null>;
  getCheckout(id: string): CheckoutRecord | undefined;
  abandon(id: string): Promise<void>;
  database?(): AppDb;
};

export type ReturnState = "paid" | "cancelled" | "unknown";

export type CheckoutReturnResult = {
  state: ReturnState;
  listing: Listing | null;
  checkout: CheckoutRecord | null;
};

export class PaymentError extends Error {
  constructor(
    readonly code: string,
    readonly httpStatus: number,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "PaymentError";
  }
}

function envText(env: PaymentEnv, key: string): string | undefined {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

/**
 * Provider predicates. They intentionally only expose Waffo's explicit
 * modes; legacy provider flags are inert and cannot select a provider.
 */
export function isProviderLive(env: PaymentEnv = process.env): boolean {
  const mode =
    envText(env, "PAYMENT_MODE") ??
    envText(env, "WAFFO_MODE") ??
    envText(env, "PAYMENT_PROVIDER_MODE");
  return mode === "waffo-test" || mode === "waffo-prod";
}

export function fixtureOnly(env: PaymentEnv = process.env): boolean {
  return (
    envText(env, "PAYMENT_MODE") === "fixture" ||
    envText(env, "WAFFO_MODE") === "fixture" ||
    envText(env, "PAYMENT_PROVIDER_MODE") === "fixture"
  );
}

export function parseBidUsd(raw: unknown): number {
  return parseUsdAmount(raw, MIN_BID_USD);
}

/** Raises charge only the target-minus-current difference, in whole USD. */
export function parseChargeUsd(raw: unknown): number {
  return parseUsdAmount(raw, 1);
}

function parseUsdAmount(raw: unknown, minUsd: number): number {
  if (typeof raw === "boolean") {
    throw new PaymentError("bid_not_integer", 400);
  }
  if (typeof raw === "number") {
    if (!Number.isSafeInteger(raw)) {
      throw new PaymentError("bid_not_integer", 400);
    }
    return assertUsdRange(raw, minUsd);
  }
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new PaymentError("bid_not_integer", 400);
  }
  const trimmed = raw.trim().replace(/^\$/, "");
  if (!/^[0-9]+$/.test(trimmed)) {
    throw new PaymentError("bid_not_integer", 400);
  }
  return assertUsdRange(Number(trimmed), minUsd);
}

function assertUsdRange(value: number, minUsd: number): number {
  if (!Number.isSafeInteger(value)) {
    throw new PaymentError("bid_not_integer", 400);
  }
  if (value < minUsd) {
    throw new PaymentError("bid_too_low", 400);
  }
  if (value > MAX_BID_USD) {
    throw new PaymentError("bid_too_high", 400);
  }
  return value;
}

export function parseListingDraft(
  input: Record<string, unknown>,
  options: { requireLicense?: boolean } = {},
): ListingDraft {
  const business = readBusiness(input.business);
  const cityLookup = resolveCity(readRequired(input.city, "city").toLowerCase());
  if (!cityLookup.ok) {
    throw new PaymentError(cityLookup.code, cityLookup.status);
  }
  const categoryLookup = resolveCategory(readRequired(input.category, "category"));
  if (!categoryLookup.ok) {
    throw new PaymentError(categoryLookup.code, categoryLookup.status);
  }
  const siteUrl = readSiteUrl(input.siteUrl ?? input.site);
  const rawLicense = readOptionalText(input.licenseId);
  let licenseId = rawLicense;
  if (options.requireLicense !== false) {
    try {
      licenseId = requireClaimedLicense(categoryLookup.value.slug, rawLicense);
    } catch (error) {
      if (error instanceof TakedownError) {
        throw new PaymentError(error.code, error.httpStatus, error.message);
      }
      throw error;
    }
  }
  const bidUsd = parseBidUsd(input.amount ?? input.amountUsd ?? input.bidUsd);
  const weekId = readOptionalText(input.weekId) ?? currentWeekId();
  return {
    business,
    category: categoryLookup.value.slug,
    city: cityLookup.value.slug,
    siteUrl,
    licenseId,
    bidUsd,
    weekId,
  };
}

function readRequired(raw: unknown, field: string): string {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new PaymentError("invalid_listing", 400, `Missing ${field}`);
  }
  return raw.trim();
}

function readBusiness(raw: unknown): string {
  const text = readRequired(raw, "business");
  if (text.length > 80) {
    throw new PaymentError("invalid_listing", 400, "Business must be 1–80 characters");
  }
  return text;
}

function readSiteUrl(raw: unknown): string {
  const text = readRequired(raw, "siteUrl");
  try {
    return canonicalizeSiteUrl(text);
  } catch (error) {
    if (error instanceof UrlError) {
      throw new PaymentError(error.code, error.httpStatus, error.message);
    }
    throw error;
  }
}

function readOptionalText(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  return text === "" ? null : text;
}

export function firstQuery(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Browser returns are informational; only a verified Waffo event settles. */
export async function handleCheckoutReturn(
  params: {
    checkout?: string | string[];
    checkoutId?: string | string[];
    checkout_id?: string | string[];
    status?: string | string[];
  },
  port: PaymentPort,
): Promise<CheckoutReturnResult> {
  const checkoutId =
    firstQuery(params.checkout) ??
    firstQuery(params.checkoutId) ??
    firstQuery(params.checkout_id);
  const rawStatus = (firstQuery(params.status) ?? "").toLowerCase();
  const canceled = rawStatus === "cancel" || rawStatus === "canceled" || rawStatus === "cancelled";

  if (canceled) {
    // A browser callback is untrusted and may race a provider capture. Live
    // state is changed only by a verified webhook or trusted operator flow.
    if (checkoutId && port.kind !== "live") await port.abandon(checkoutId);
    return {
      state: "cancelled",
      listing: null,
      checkout: checkoutId ? (port.getCheckout(checkoutId) ?? null) : null,
    };
  }
  if (!checkoutId) return { state: "unknown", listing: null, checkout: null };
  const existing = port.getCheckout(checkoutId);
  if (!existing) return { state: "unknown", listing: null, checkout: null };
  if (existing.status === "cancelled") {
    return { state: "cancelled", listing: null, checkout: existing };
  }
  const listing = await port.settle(checkoutId);
  const checkout = port.getCheckout(checkoutId) ?? existing;
  if (!listing) {
    if (checkout.status === "cancelled") {
      return { state: "cancelled", listing: null, checkout };
    }
    return { state: "unknown", listing: null, checkout };
  }
  return { state: "paid", listing, checkout };
}
