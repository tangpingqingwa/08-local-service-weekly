import { createHash, randomBytes } from "node:crypto";

import {
  WaffoPancake,
  WaffoPancakeError,
  TaxCategory,
  verifyWebhook,
  type AnonymousCheckoutParams,
  type WebhookEvent,
} from "@waffo/pancake-ts";

import { getDb, type AppDb, type Listing } from "../db";
import { applyRaise, findListingByIdentity, getListingById } from "../listings";
import { requireClaimedLicense, TakedownError } from "../takedown";
import {
  currentWeekId,
  ensureWeek,
  nowUtc,
  requireOpenWeek,
  ROLLING_WEEK_CLOCK_SKEW_MS,
  ROLLING_WEEK_MS,
  WeekError,
} from "../week";
import {
  parseBidUsd,
  parseChargeUsd,
  PaymentError,
  type CheckoutIntent,
  type CheckoutRecord,
  type CheckoutStart,
  type CreateCheckoutInput,
  type ListingDraft,
  type PaymentEnv,
  type PaymentPort,
  type ProviderCheckoutState,
} from "./port";
import {
  requireWaffoMerchantId,
  requireWaffoMode,
  requireWaffoPrivateKey,
  requireWaffoProductId,
  requireWaffoStoreId,
  validateWaffoConfiguration,
  waffoApiBase,
  waffoEnvironment,
  waffoMode,
  waffoPublicBaseUrl,
  type WaffoMode,
} from "./waffo-session";

/** Provider-neutral helper retained for callers that need the configured Waffo host. */
export function waffoApiBaseCompat(env: PaymentEnv = process.env): string {
  return waffoApiBase(env);
}

export type LiveWaffoOptions = {
  env?: PaymentEnv;
  fetch?: typeof fetch;
  db?: AppDb;
  /** Bounds fetch and the SDK's complete response.json() parse. */
  checkoutTimeoutMs?: number;
};

type IntentRow = {
  intent_id: string;
  intent_kind: CheckoutIntent;
  intent_fingerprint: string;
  business: string;
  category: ListingDraft["category"];
  city: string;
  site_url: string;
  license_id: string | null;
  week_id: string;
  target_bid_cents: number;
  quote_base_bid_cents: number;
  charge_cents: number;
  provider_mode: "waffo-test" | "waffo-prod";
  provider_store_id: string;
  provider_product_id: string;
  currency: "USD";
  tax_category: "digital_goods";
  state:
    | "creating"
    | "open"
    | "unknown"
    | "paid"
    | "rejected"
    | "needs_reconciliation";
  provider_session_id: string | null;
  checkout_url: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
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
  provider_checkout_id: string | null;
  provider_product_id: string | null;
  currency: string;
  provider_state: ProviderCheckoutState;
};

function envText(env: PaymentEnv, key: string): string | undefined {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

/** Existing callers use this name; it now validates Waffo's complete config. */
export function validateLiveConfiguration(env: PaymentEnv = process.env): void {
  const mode = validateWaffoConfiguration(env);
  if (mode === "fixture") {
    throw new PaymentError("waffo_not_live", 503, "fixture mode is not a live provider");
  }
}

function openWeekId(id: string): string {
  try {
    return requireOpenWeek(id);
  } catch (error) {
    if (error instanceof WeekError) {
      throw new PaymentError(error.code, error.httpStatus, error.message);
    }
    throw error;
  }
}

function claimedLicense(category: ListingDraft["category"], licenseId: string | null): string | null {
  try {
    return requireClaimedLicense(category, licenseId);
  } catch (error) {
    if (error instanceof TakedownError) {
      throw new PaymentError(error.code, error.httpStatus, error.message);
    }
    throw error;
  }
}

function newCheckoutId(): string {
  return `chk_${randomBytes(12).toString("hex")}`;
}

function newListingId(): string {
  return `lst_${randomBytes(12).toString("hex")}`;
}

function canonicalFingerprintValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalFingerprintValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonicalFingerprintValue(item)]),
    );
  }
  return value;
}

export function hashFingerprint(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalFingerprintValue(value)))
    .digest("hex");
}

function centsToDisplayString(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new PaymentError("invalid_amount", 400);
  }
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

/** Decimal display strings are parsed without floating point arithmetic. */
export function decimalDisplayToCents(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(trimmed)) return undefined;
  const [whole, fraction = ""] = trimmed.split(".");
  const cents = Number(`${whole}${fraction.padEnd(2, "0")}`);
  return Number.isSafeInteger(cents) ? cents : undefined;
}

function isoTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim() || value !== value.trim()) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) || date.toISOString() !== value ? undefined : value;
}

const WAFFO_CHECKOUT_HOSTS = new Set(["pancake.waffo.ai", "checkout.waffo.ai"]);
const MAX_CHECKOUT_EXPIRY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CHECKOUT_TIMEOUT_MS = 15_000;
const MAX_CHECKOUT_TIMEOUT_MS = 60_000;

function normalizedCheckoutTimeout(value: number | undefined): number {
  if (!Number.isFinite(value) || value === undefined || value <= 0) {
    return DEFAULT_CHECKOUT_TIMEOUT_MS;
  }
  return Math.min(Math.max(1, Math.floor(value)), MAX_CHECKOUT_TIMEOUT_MS);
}

type CheckoutDeadline = {
  signal: AbortSignal;
  expired: Promise<never>;
  cleanup: () => void;
};

/**
 * Compose the caller's abort signal with a bounded checkout deadline. The
 * deadline promise is also raced against fetch itself because a test/durable
 * transport may not observe AbortSignal, and against response.json() because
 * the official SDK parses the complete body after fetch resolves.
 */
function checkoutDeadline(
  parentSignal: AbortSignal | null | undefined,
  timeoutMs: number,
): CheckoutDeadline {
  const controller = new AbortController();
  let rejectExpired!: (reason?: unknown) => void;
  const expired = new Promise<never>((_, reject) => {
    rejectExpired = reject;
  });
  // The timer can fire before the SDK calls response.json(). Attach a handler
  // now so that an abandoned response cannot create an unhandled rejection.
  void expired.catch(() => undefined);
  const abort = (reason: unknown): void => {
    if (!controller.signal.aborted) controller.abort(reason);
    rejectExpired(reason);
  };
  const onParentAbort = (): void => abort(parentSignal?.reason ?? new Error("checkout aborted"));
  if (parentSignal?.aborted) {
    onParentAbort();
  } else {
    parentSignal?.addEventListener("abort", onParentAbort, { once: true });
  }
  const timer = setTimeout(
    () => abort(new Error("Waffo checkout deadline exceeded")),
    timeoutMs,
  );
  let cleaned = false;
  return {
    signal: controller.signal,
    expired,
    cleanup: () => {
      if (cleaned) return;
      cleaned = true;
      clearTimeout(timer);
      parentSignal?.removeEventListener("abort", onParentAbort);
    },
  };
}

/**
 * Keep the official SDK boundary intact while making its full operation
 * deadline-aware. In particular, awaiting fetch alone is insufficient:
 * pancake-ts awaits response.json() after headers arrive.
 */
function fetchWithCheckoutDeadline(
  fetchImpl: typeof fetch,
  timeoutMs: number,
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const deadline = checkoutDeadline(init?.signal, timeoutMs);
    const request = Promise.resolve().then(() =>
      fetchImpl(input, { ...init, signal: deadline.signal }),
    );
    void request.catch(() => undefined);
    let response: Response;
    try {
      response = await Promise.race([request, deadline.expired]);
    } catch (error) {
      deadline.cleanup();
      throw error;
    }

    const originalJson = response.json.bind(response);
    return new Proxy(response, {
      get(target, property) {
        if (property === "json") {
          return async (): Promise<unknown> => {
            const body = Promise.resolve().then(() => originalJson());
            void body.catch(() => undefined);
            try {
              return await Promise.race([body, deadline.expired]);
            } finally {
              deadline.cleanup();
              if (deadline.signal.aborted) {
                // A response body can remain locked after the SDK's parser
                // loses the deadline race. Best-effort cancellation releases
                // the transport without delaying the retryable result.
                void response.body?.cancel().catch(() => undefined);
              }
            }
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }) as typeof fetch;
}

/** Waffo's hosted checkout URL, bound to the returned provider session. */
export function validCheckoutUrl(value: unknown, sessionId: string): string | undefined {
  if (typeof value !== "string" || !value || value !== value.trim()) return undefined;
  const text = value;
  if (!text) return undefined;
  try {
    const parsed = new URL(text);
    if (
      parsed.protocol !== "https:" ||
      !WAFFO_CHECKOUT_HOSTS.has(parsed.hostname.toLowerCase()) ||
      parsed.username ||
      parsed.password ||
      parsed.port ||
      parsed.search ||
      parsed.hash ||
      /%/.test(parsed.pathname)
    ) {
      return undefined;
    }
    // The SDK documents pancake.waffo.ai/store/{slug}/checkout/{sessionId}
    // and the hosted checkout alias exposes /checkout/{sessionId}. Keep both
    // official Waffo origins, but never accept a root or unrelated path.
    const parts = parsed.pathname.split("/").filter(Boolean);
    const pathSessionId =
      (parsed.hostname.toLowerCase() === "pancake.waffo.ai" &&
        parts.length === 4 &&
        parts[0] === "store" &&
        parts[2] === "checkout" &&
        parts[3]) ||
      (parsed.hostname.toLowerCase() === "checkout.waffo.ai" &&
        ((parts.length === 1 && parts[0]) ||
          (parts.length === 2 && parts[0] === "checkout" && parts[1]))) ||
      undefined;
    return pathSessionId === sessionId ? text : undefined;
  } catch {
    return undefined;
  }
}

/** Provider responses must carry Waffo's canonical UTC expiry while usable. */
function validCheckoutExpiry(value: unknown, now = Date.now()): string | undefined {
  const canonical = isoTimestamp(value);
  if (!canonical) return undefined;
  const expiresAt = Date.parse(canonical);
  return expiresAt > now && expiresAt <= now + MAX_CHECKOUT_EXPIRY_MS
    ? canonical
    : undefined;
}

function validProviderEventTime(
  value: string | undefined,
  intentCreatedAt: string,
  now = nowUtc().getTime(),
): boolean {
  if (!value) return false;
  const providerTime = Date.parse(value);
  const intentTime = Date.parse(intentCreatedAt);
  return Number.isFinite(providerTime) &&
    Number.isFinite(intentTime) &&
    // Provider-paid time is causally anchored to the immutable intent. The
    // same 100ms clock tolerance and rolling seven-day window used by board
    // visibility apply here, so accepted paid rows cannot be invisible.
    providerTime >= intentTime - ROLLING_WEEK_CLOCK_SKEW_MS &&
    providerTime >= now - ROLLING_WEEK_MS &&
    providerTime <= now + ROLLING_WEEK_CLOCK_SKEW_MS;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function canonicalEventMode(value: unknown): "test" | "prod" | undefined {
  // Unlike IDs and metadata, the signed environment marker is not a free-form
  // text field. Preserve exact Waffo spelling and reject whitespace/aliases.
  return value === "test" || value === "prod" ? value : undefined;
}

const INVALID_MONETARY_FIELD = "__invalid_present_monetary_field__";

/** Preserve presence so malformed provider fields cannot disappear as absent. */
function monetaryField(record: Record<string, unknown>, camel: string, snake = camel): string | undefined {
  let value: unknown;
  if (Object.prototype.hasOwnProperty.call(record, camel)) {
    value = record[camel];
  } else if (Object.prototype.hasOwnProperty.call(record, snake)) {
    value = record[snake];
  } else {
    return undefined;
  }
  return typeof value === "string" ? value.trim() : INVALID_MONETARY_FIELD;
}

function field(record: Record<string, unknown>, camel: string, snake: string): unknown {
  return record[camel] ?? record[snake];
}

function metadataForIntent(
  listing: ListingDraft,
  intent: CheckoutIntent,
  intentId: string,
  fingerprint: string,
  targetBidCents: number,
  quoteBaseBidCents: number,
  chargeCents: number,
  providerProductId?: string,
): Record<string, string> {
  const metadata: Record<string, string> = {
    intentId,
    intentFingerprint: fingerprint,
    intent,
    targetBidCents: String(targetBidCents),
    quoteBaseBidCents: String(quoteBaseBidCents),
    chargeCents: String(chargeCents),
    canonicalUrl: listing.siteUrl,
    business: listing.business,
    category: listing.category,
    city: listing.city,
    weekId: listing.weekId ?? "",
    licenseId: listing.licenseId ?? "",
  };
  if (providerProductId) metadata.providerProductId = providerProductId;
  return metadata;
}

function listingFromIntent(intent: IntentRow): ListingDraft {
  return {
    business: intent.business,
    category: intent.category,
    city: intent.city,
    siteUrl: intent.site_url,
    licenseId: intent.license_id,
    bidUsd: intent.target_bid_cents / 100,
    weekId: intent.week_id,
  };
}

function providerState(state: IntentRow["state"]): ProviderCheckoutState {
  if (state === "creating") return "pending";
  if (state === "open") return "attached";
  if (state === "unknown" || state === "needs_reconciliation") return "unknown";
  if (state === "rejected") return "failed";
  return "attached";
}

function checkoutFromRows(row: CheckoutRow, intent?: IntentRow): CheckoutRecord & { createdAt: string } {
  return {
    id: row.id,
    amountUsd: row.amount_usd,
    listing: intent ? listingFromIntent(intent) : {
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
    providerCheckoutId: row.provider_checkout_id ?? intent?.provider_session_id ?? undefined,
    providerProductId: row.provider_product_id ?? intent?.provider_product_id,
    currency: row.currency,
    providerState: intent ? providerState(intent.state) : row.provider_state,
    createdAt: row.created_at,
  };
}

function readCheckoutRow(db: AppDb, id: string): CheckoutRow | undefined {
  return db.prepare(`
    SELECT c.id, c.amount_usd, c.business, c.category, c.city, c.site_url,
           c.license_id, c.week_id, c.status, c.listing_id, c.created_at,
           c.intent, c.target_bid_usd, c.provider_checkout_id,
           c.provider_product_id, c.currency,
           COALESCE(s.provider_state, 'pending') AS provider_state
      FROM checkouts AS c
      LEFT JOIN checkout_provider_sessions AS s ON s.local_checkout_id = c.id
     WHERE c.id = ? OR c.provider_checkout_id = ?
     LIMIT 1
  `).get(id, id) as CheckoutRow | undefined;
}

function readIntent(db: AppDb, id: string): IntentRow | undefined {
  return db.prepare("SELECT * FROM waffo_intents WHERE intent_id = ?").get(id) as IntentRow | undefined;
}

function readIntentForCheckout(db: AppDb, checkout: { id: string }): IntentRow | undefined {
  return readIntent(db, checkout.id);
}

function transitionIntentState(
  current: IntentRow["state"],
  requested: IntentRow["state"],
): IntentRow["state"] {
  // Provider response handling can race a signed capture. Once a capture is
  // paid, or a captured payment is awaiting reconciliation, a late local
  // response must never turn it back into an open/unknown/rejected intent.
  if (current === "paid" && requested !== "paid") return current;
  if (
    current === "needs_reconciliation" &&
    requested !== "paid" &&
    requested !== "needs_reconciliation"
  ) {
    return current;
  }
  return requested;
}

function markIntentState(
  db: AppDb,
  id: string,
  state: IntentRow["state"],
  providerSessionId?: string,
  checkoutUrl?: string,
  expiresAt?: string,
): void {
  const now = new Date().toISOString();
  const current = readIntent(db, id);
  const next = current ? transitionIntentState(current.state, state) : state;
  db.prepare(`
    UPDATE waffo_intents
       SET state = ?,
           provider_session_id = COALESCE(?, provider_session_id),
           checkout_url = COALESCE(?, checkout_url),
           expires_at = COALESCE(?, expires_at),
           updated_at = ?
     WHERE intent_id = ?
  `).run(next, providerSessionId ?? null, checkoutUrl ?? null, expiresAt ?? null, now, id);
  db.prepare(`
    UPDATE waffo_checkout_events
       SET state = ?, provider_session_id = COALESCE(?, provider_session_id), updated_at = ?
     WHERE intent_id = ?
  `).run(next, providerSessionId ?? null, now, id);
}

function markUnknown(db: AppDb, id: string, providerSessionId?: string, checkoutUrl?: string, expiresAt?: string): void {
  try {
    const tx = db.transaction(() => {
      markIntentState(db, id, "unknown", providerSessionId, checkoutUrl, expiresAt);
    });
    tx();
  } catch {
    // The original immutable intent remains the recovery anchor. Do not turn
    // an ambiguous provider outcome into a local cancellation.
  }
}

function isDefinitiveClientError(error: unknown): boolean {
  if (!(error instanceof WaffoPancakeError) || error.status < 400 || error.status >= 500) {
    return false;
  }
  // These statuses are explicitly recoverable/ambiguous for checkout. A
  // retry may have created a provider session even when this response failed.
  if ([408, 409, 425, 429].includes(error.status)) return false;
  // pancake-ts uses layer=sdk for local validation and non-JSON/body parsing
  // failures. Only a complete provider error envelope is terminal.
  return Array.isArray(error.errors) && error.errors.length > 0 &&
    error.errors.every((notice) => {
      if (!notice || typeof notice !== "object") return false;
      const candidate = notice as { message?: unknown; layer?: unknown };
      return typeof candidate.message === "string" && candidate.message.trim() !== "" &&
        typeof candidate.layer === "string" && candidate.layer.trim() !== "" &&
        candidate.layer.toLowerCase() !== "sdk";
    });
}

/**
 * Waffo live checkout. The SDK is created without a request; the first
 * network call happens only after the complete immutable intent is stored.
 */
export class LivePaymentPort implements PaymentPort {
  readonly kind = "live" as const;
  private readonly env: PaymentEnv;
  private readonly db: AppDb;
  private readonly mode: "waffo-test" | "waffo-prod";
  private readonly productId: string;
  private readonly storeId: string;
  private readonly client: WaffoPancake;

  constructor(options: LiveWaffoOptions = {}) {
    this.env = options.env ?? process.env;
    const selected = validateWaffoConfiguration(this.env, {
      databaseInjected: Boolean(options.db),
    });
    if (selected === "fixture") {
      throw new PaymentError("waffo_not_live", 503, "fixture mode is not a live provider");
    }
    this.mode = selected;
    this.db = options.db ?? getDb();
    this.productId = requireWaffoProductId(this.env);
    this.storeId = requireWaffoStoreId(this.env);
    this.client = new WaffoPancake({
      merchantId: requireWaffoMerchantId(this.env),
      privateKey: requireWaffoPrivateKey(this.env),
      baseUrl: waffoApiBase(this.env),
      environment: waffoEnvironment(selected),
      fetch: fetchWithCheckoutDeadline(
        options.fetch ?? fetch,
        normalizedCheckoutTimeout(options.checkoutTimeoutMs),
      ),
    });
  }

  database(): AppDb {
    return this.db;
  }

  /** Captured configuration used by route settlement after selection. */
  environment(): PaymentEnv {
    return this.env;
  }

  /** Route-level verification uses the same explicit env captured at startup. */
  verifyWebhook(rawBody: string, signature: string | null | undefined): WebhookEvent {
    return verifyWaffoWebhook(rawBody, signature, this.env);
  }

  async createCheckout(input: CreateCheckoutInput): Promise<CheckoutStart> {
    const intent = input.intent ?? "place";
    const amountUsd = intent === "raise" ? parseChargeUsd(input.amountUsd) : parseBidUsd(input.amountUsd);
    const weekId = openWeekId(input.listing.weekId ?? currentWeekId());
    ensureWeek(this.db, weekId);
    const targetBidUsd = intent === "raise" ? parseBidUsd(input.listing.bidUsd) : amountUsd;
    const listing: ListingDraft = {
      ...input.listing,
      licenseId: claimedLicense(input.listing.category, input.listing.licenseId),
      bidUsd: targetBidUsd,
      weekId,
    };
    const chargeCents = amountUsd * 100;
    const targetBidCents = targetBidUsd * 100;
    const quoteBaseBidCents = intent === "raise" ? targetBidCents - chargeCents : 0;
    const intentId = newCheckoutId();
    const fingerprint = hashFingerprint({
      intent,
      mode: this.mode,
      storeId: this.storeId,
      productId: this.productId,
      currency: "USD",
      taxCategory: "digital_goods",
      business: listing.business,
      category: listing.category,
      city: listing.city,
      canonicalUrl: listing.siteUrl,
      licenseId: listing.licenseId ?? "",
      weekId,
      targetBidCents,
      quoteBaseBidCents,
      chargeCents,
    });
    const createdAt = new Date().toISOString();

    const metadata = metadataForIntent(
      listing,
      intent,
      intentId,
      fingerprint,
      targetBidCents,
      quoteBaseBidCents,
      chargeCents,
      this.productId,
    );
    const params: AnonymousCheckoutParams = {
      productId: this.productId,
      currency: "USD",
      priceSnapshot: {
        amount: centsToDisplayString(chargeCents),
        taxCategory: TaxCategory.DigitalGoods,
      },
      successUrl: `${waffoPublicBaseUrl(this.env)}/checkout/complete?intent=${encodeURIComponent(intentId)}`,
      orderMerchantExternalId: intentId,
      metadata,
    };

    // No provider call precedes this transaction. Every webhook fact is
    // checked against this complete immutable row.
    try {
      const tx = this.db.transaction(() => {
        this.db.prepare(`
          INSERT INTO checkouts (
            id, amount_usd, business, category, city, site_url, license_id,
            week_id, status, listing_id, created_at, intent, target_bid_usd,
            provider_checkout_id, provider_product_id, currency
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', NULL, ?, ?, ?, NULL, ?, ?)
        `).run(
          intentId,
          amountUsd,
          listing.business,
          listing.category,
          listing.city,
          listing.siteUrl,
          listing.licenseId,
          weekId,
          createdAt,
          intent,
          targetBidUsd,
          this.productId,
          "USD",
        );
        this.db.prepare(`
          INSERT INTO waffo_intents (
            intent_id, intent_kind, intent_fingerprint, business, category, city,
            site_url, license_id, week_id, target_bid_cents, quote_base_bid_cents,
            charge_cents, provider_mode, provider_store_id, provider_product_id,
            currency, tax_category, state, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'creating', ?, ?)
        `).run(
          intentId,
          intent,
          fingerprint,
          listing.business,
          listing.category,
          listing.city,
          listing.siteUrl,
          listing.licenseId,
          weekId,
          targetBidCents,
          quoteBaseBidCents,
          chargeCents,
          this.mode,
          this.storeId,
          this.productId,
          "USD",
          "digital_goods",
          createdAt,
          createdAt,
        );
        this.db.prepare(`
          INSERT INTO waffo_checkout_events
            (intent_id, state, created_at, updated_at)
          VALUES (?, 'creating', ?, ?)
        `).run(intentId, createdAt, createdAt);
      });
      tx();
    } catch {
      throw new PaymentError("waffo_persist_failed", 503, "unable to persist checkout intent");
    }

    let session: { sessionId?: unknown; checkoutUrl?: unknown; expiresAt?: unknown };
    try {
      session = await this.client.checkout.anonymous.create(params);
    } catch (error) {
      const definitive = isDefinitiveClientError(error);
      markUnknown(this.db, intentId);
      if (definitive) {
        markIntentState(this.db, intentId, "rejected");
        throw new PaymentError("waffo_checkout_rejected", 400, "Waffo rejected checkout intent");
      }
      throw new PaymentError("waffo_checkout_unknown", 503, "Waffo checkout outcome is unknown");
    }
    const providerSessionId = readString(session.sessionId);
    if (!providerSessionId) {
      markUnknown(this.db, intentId);
      throw new PaymentError("waffo_checkout_unknown", 503, "invalid Waffo checkout response");
    }
    const checkoutUrl = validCheckoutUrl(session.checkoutUrl, providerSessionId);
    const expiresAt = validCheckoutExpiry(session.expiresAt);
    if (!providerSessionId || !checkoutUrl || !expiresAt) {
      markUnknown(this.db, intentId);
      throw new PaymentError("waffo_checkout_unknown", 503, "invalid Waffo checkout response");
    }

    try {
      const tx = this.db.transaction(() => {
        const checkout = this.db.prepare(`
          SELECT status, provider_checkout_id, listing_id
            FROM checkouts
           WHERE id = ?
        `).get(intentId) as {
          status: CheckoutRecord["status"];
          provider_checkout_id: string | null;
          listing_id: string | null;
        } | undefined;
        const currentIntent = readIntent(this.db, intentId);
        const checkoutEvent = this.db.prepare(`
          SELECT state, provider_session_id, response_fingerprint
            FROM waffo_checkout_events
           WHERE intent_id = ?
        `).get(intentId) as {
          state: string;
          provider_session_id: string | null;
          response_fingerprint: string | null;
        } | undefined;
        if (!checkout || !currentIntent || !checkoutEvent) {
          throw new Error("checkout intent disappeared before attach");
        }
        if (
          (checkout.provider_checkout_id && checkout.provider_checkout_id !== providerSessionId) ||
          (currentIntent.provider_session_id && currentIntent.provider_session_id !== providerSessionId) ||
          (checkoutEvent.provider_session_id && checkoutEvent.provider_session_id !== providerSessionId) ||
          (currentIntent.checkout_url && currentIntent.checkout_url !== checkoutUrl) ||
          (currentIntent.expires_at && currentIntent.expires_at !== expiresAt)
        ) {
          throw new Error("conflicting Waffo checkout attachment");
        }

        // Attach the provider identity independently of lifecycle status. A
        // webhook may have paid the intent while the SDK response was still
        // being parsed; this update must enrich that paid row, never reopen it.
        const attachedCheckout = this.db.prepare(`
          UPDATE checkouts
             SET provider_checkout_id = COALESCE(provider_checkout_id, ?)
           WHERE id = ?
             AND (provider_checkout_id IS NULL OR provider_checkout_id = ?)
        `).run(providerSessionId, intentId, providerSessionId);
        if (attachedCheckout.changes !== 1) {
          throw new Error("unable to attach checkout provider identity");
        }

        const now = new Date().toISOString();
        const responseFingerprint = hashFingerprint({ providerSessionId, checkoutUrl, expiresAt });
        const attachedIntent = this.db.prepare(`
          UPDATE waffo_intents
             SET state = CASE WHEN state = 'creating' THEN 'open' ELSE state END,
                 provider_session_id = COALESCE(provider_session_id, ?),
                 checkout_url = COALESCE(checkout_url, ?),
                 expires_at = COALESCE(expires_at, ?),
                 updated_at = ?
           WHERE intent_id = ?
             AND (provider_session_id IS NULL OR provider_session_id = ?)
             AND (checkout_url IS NULL OR checkout_url = ?)
             AND (expires_at IS NULL OR expires_at = ?)
        `).run(providerSessionId, checkoutUrl, expiresAt, now, intentId, providerSessionId, checkoutUrl, expiresAt);
        if (attachedIntent.changes !== 1) {
          throw new Error("unable to attach intent provider identity");
        }

        const attachedEvent = this.db.prepare(`
          UPDATE waffo_checkout_events
             SET state = CASE WHEN state = 'creating' THEN 'open' ELSE state END,
                 provider_session_id = COALESCE(provider_session_id, ?),
                 response_fingerprint = COALESCE(response_fingerprint, ?),
                 updated_at = ?
           WHERE intent_id = ?
             AND (provider_session_id IS NULL OR provider_session_id = ?)
             AND (response_fingerprint IS NULL OR response_fingerprint = ?)
        `).run(providerSessionId, responseFingerprint, now, intentId, providerSessionId, responseFingerprint);
        if (attachedEvent.changes !== 1) {
          throw new Error("unable to attach checkout event provider identity");
        }
      });
      tx();
    } catch {
      // The provider may already have accepted the session. Keep the local
      // intent unknown and let the signed order.completed reconcile by intent
      // metadata, even when attaching provider_checkout_id failed.
      markUnknown(this.db, intentId, providerSessionId, checkoutUrl, expiresAt);
      throw new PaymentError("waffo_checkout_unknown", 503, "unable to attach Waffo checkout");
    }

    const attached = readCheckoutRow(this.db, intentId);
    if (!attached) {
      throw new PaymentError("waffo_checkout_unknown", 503, "attached Waffo checkout disappeared");
    }
    return {
      id: intentId,
      status: attached.status,
      url: checkoutUrl,
      listingId: attached.listing_id ?? undefined,
      providerCheckoutId: attached.provider_checkout_id ?? providerSessionId,
    };
  }

  async settle(id: string): Promise<Listing | null> {
    const checkout = this.loadCheckout(id);
    if (!checkout || checkout.status !== "paid" || !checkout.listingId) return null;
    return getListingById(this.db, checkout.listingId) ?? null;
  }

  async abandon(id: string): Promise<void> {
    const checkout = this.loadCheckout(id);
    if (!checkout || checkout.status !== "open") return;
    const intent = readIntentForCheckout(this.db, checkout);
    // A return/cancel click cannot prove that an ambiguous provider call did
    // not capture money. Keep creating/unknown/reconciliation intents open so
    // a later signed order.completed can still reconcile them.
    if (
      intent?.state === "creating" ||
      intent?.state === "unknown" ||
      intent?.state === "needs_reconciliation"
    ) {
      return;
    }
    const nextState = "rejected";
    const tx = this.db.transaction(() => {
      this.db.prepare(`
        UPDATE checkouts SET status = 'cancelled'
         WHERE id = ? OR provider_checkout_id = ?
      `).run(checkout.id, id);
      if (intent) markIntentState(this.db, intent.intent_id, nextState);
      this.db.prepare(`
        UPDATE waffo_checkout_events SET state = 'cancelled', updated_at = ? WHERE intent_id = ?
      `).run(new Date().toISOString(), checkout.id);
    });
    tx();
  }

  getCheckout(id: string): CheckoutRecord | undefined {
    const row = readCheckoutRow(this.db, id);
    if (!row) return undefined;
    return checkoutFromRows(row, readIntentForCheckout(this.db, row));
  }

  private loadCheckout(id: string): (CheckoutRecord & { createdAt: string }) | undefined {
    const row = readCheckoutRow(this.db, id);
    return row ? checkoutFromRows(row, readIntentForCheckout(this.db, row)) : undefined;
  }
}

type NormalizedWaffoEvent = {
  deliveryId: string;
  eventType: string;
  eventId?: string;
  eventMode?: string;
  storeId?: string;
  providerEventAt?: string;
  orderId?: string;
  paymentId?: string;
  intentId?: string;
  productId?: string;
  currency?: string;
  orderStatus?: string;
  paymentStatus?: string;
  amount?: string;
  taxAmount?: string;
  subtotal?: string;
  total?: string;
  metadata: Record<string, unknown>;
  metadataPresent: boolean;
  metadataMalformed: boolean;
  payloadFingerprint: string;
  factsFingerprint: string;
};

function normalizeMetadata(value: unknown): Record<string, unknown> {
  const record = asRecord(value);
  return record ?? {};
}

function normalizeWaffoEvent(
  event: unknown,
  deliveryId: string | undefined,
  rawBody: string | undefined,
): NormalizedWaffoEvent {
  const root = asRecord(event) ?? {};
  const data = asRecord(root.data) ?? {};
  const resolvedDeliveryId = readString(deliveryId) ?? readString(root.id);
  const eventType =
    readString(field(root, "eventType", "event_type")) ??
    readString(root.type) ??
    "unknown";
  const rawEventMode = Object.prototype.hasOwnProperty.call(root, "mode")
    ? root.mode
    : root.environment;
  // The signed event identity is distinct from delivery id, payment id, and
  // order id. Never promote a fallback field into the business identity.
  const eventId = readString(field(root, "eventId", "event_id"));
  const providerEventAt = isoTimestamp(
    field(root, "timestamp", "event_timestamp"),
  );
  const metadataPresent =
    Object.prototype.hasOwnProperty.call(data, "orderMetadata");
  const rawMetadata = data.orderMetadata;
  const metadataRecord = asRecord(rawMetadata);
  const metadata = normalizeMetadata(rawMetadata);
  const metadataMalformed = metadataPresent && !metadataRecord;
  // Product identity is a provider-signed direct field. Product metadata and
  // merchant order metadata are supplemental facts, never substitutes for a
  // missing or malformed data.productId.
  const productId = Object.prototype.hasOwnProperty.call(data, "productId")
    ? readString(data.productId)
    : undefined;
  const facts = {
    eventType,
    eventId: eventId ?? null,
    eventMode: canonicalEventMode(rawEventMode),
    storeId: readString(field(root, "storeId", "store_id")),
    providerEventAt,
    orderId: readString(field(data, "orderId", "order_id")),
    paymentId: readString(field(data, "paymentId", "payment_id")),
    intentId: readString(field(data, "orderMerchantExternalId", "order_merchant_external_id")),
    productId,
    currency: readString(data.currency),
    orderStatus: readString(field(data, "orderStatus", "order_status")),
    paymentStatus: readString(field(data, "paymentStatus", "payment_status")),
    amount: monetaryField(data, "amount"),
    taxAmount: monetaryField(data, "taxAmount", "tax_amount"),
    subtotal: monetaryField(data, "subtotal"),
    total: monetaryField(data, "total"),
    metadata,
    metadataPresent,
    metadataMalformed,
  };
  const body = rawBody ?? JSON.stringify(canonicalFingerprintValue(event));
  return {
    deliveryId: resolvedDeliveryId ?? "missing-delivery-id",
    eventType,
    eventId,
    eventMode: facts.eventMode,
    storeId: facts.storeId,
    providerEventAt,
    orderId: facts.orderId,
    paymentId: facts.paymentId,
    intentId: facts.intentId,
    productId,
    currency: facts.currency,
    orderStatus: facts.orderStatus,
    paymentStatus: facts.paymentStatus,
    amount: facts.amount,
    taxAmount: facts.taxAmount,
    subtotal: facts.subtotal,
    total: facts.total,
    metadata,
    metadataPresent,
    metadataMalformed,
    payloadFingerprint: createHash("sha256").update(body).digest("hex"),
    factsFingerprint: hashFingerprint(facts),
  };
}

function modeMatches(localMode: "waffo-test" | "waffo-prod", eventMode: string | undefined): boolean {
  if (!eventMode) return false;
  return eventMode === (localMode === "waffo-test" ? "test" : "prod");
}

function validateOrderCompleted(
  event: NormalizedWaffoEvent,
  intent: IntentRow,
  env: PaymentEnv,
): string | undefined {
  const expectedMode = waffoMode(env);
  if (expectedMode !== intent.provider_mode || !modeMatches(intent.provider_mode, event.eventMode)) {
    return "mode_mismatch";
  }
  if (event.storeId !== intent.provider_store_id || event.storeId !== requireWaffoStoreId(env)) {
    return "store_mismatch";
  }
  if (event.eventType !== "order.completed") return "unsupported_event";
  if (!event.eventId || !event.orderId || !event.paymentId) return "provider_identity_missing";
  if (event.eventId !== event.paymentId) return "payment_identity_mismatch";
  if (event.orderStatus !== "completed") return "order_not_completed";
  if (event.paymentStatus !== "succeeded") return "payment_not_succeeded";
  if (event.currency !== "USD" || intent.currency !== "USD") return "currency_mismatch";
  if (!event.productId || event.productId !== intent.provider_product_id) return "product_mismatch";
  if (event.intentId !== intent.intent_id) return "external_id_mismatch";
  if (!event.providerEventAt) return "provider_timestamp_missing";
  if (!validProviderEventTime(event.providerEventAt, intent.created_at)) return "provider_timestamp_stale";

  if (!event.metadataPresent || event.metadataMalformed) return "metadata_invalid";

  const expectedMetadata = metadataForIntent(
    listingFromIntent(intent),
    intent.intent_kind,
    intent.intent_id,
    intent.intent_fingerprint,
    intent.target_bid_cents,
    intent.quote_base_bid_cents,
    intent.charge_cents,
    intent.provider_product_id,
  );
  const expectedKeys = Object.keys(expectedMetadata).sort();
  const actualKeys = Object.keys(event.metadata).sort();
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    return "metadata_keys_mismatch";
  }
  if (Object.values(event.metadata).some((value) => typeof value !== "string")) {
    return "metadata_invalid";
  }
  for (const [key, expected] of Object.entries(expectedMetadata)) {
    if (event.metadata[key] !== expected) return `metadata_mismatch:${key}`;
  }

  const parsedMoney = new Map<string, number>();
  for (const [name, value] of [
    ["subtotal", event.subtotal],
    ["tax", event.taxAmount],
    ["amount", event.amount],
    ["total", event.total],
  ] as const) {
    if (value === undefined) continue;
    const cents = decimalDisplayToCents(value);
    if (cents === undefined) return `${name}_invalid`;
    parsedMoney.set(name, cents);
  }

  const subtotalCents = parsedMoney.get("subtotal");
  const taxCents = parsedMoney.get("tax");
  const amountCents = parsedMoney.get("amount");
  const totalCents = parsedMoney.get("total");
  if (subtotalCents !== undefined) {
    if (subtotalCents !== intent.charge_cents) return "subtotal_mismatch";
    if (taxCents === undefined) return "tax_missing";
    if (amountCents === undefined) return "amount_missing";
    if (totalCents === undefined) return "total_missing";
    const expectedTotal = subtotalCents + taxCents;
    if (totalCents !== expectedTotal) return "total_mismatch";
    // Waffo's amount may represent either the pre-tax subtotal or the
    // tax-inclusive total. It must still agree with the exact equation.
    if (amountCents !== subtotalCents && amountCents !== expectedTotal) {
      return "amount_mismatch";
    }
  } else {
    // Without subtotal, the contract only permits a tax-free exact charge.
    if (amountCents === undefined) return "amount_missing";
    if (taxCents === undefined) return "tax_missing";
    if (amountCents !== intent.charge_cents || taxCents !== 0) {
      return "amount_or_tax_mismatch";
    }
    if (totalCents !== undefined && totalCents !== amountCents + taxCents) {
      return "total_mismatch";
    }
  }
  return undefined;
}

function eventResult(
  event: NormalizedWaffoEvent,
  status: WaffoWebhookResult["status"],
  extras: Partial<WaffoWebhookResult> = {},
): WaffoWebhookResult {
  return {
    status,
    durable: extras.durable ?? true,
    eventId: event.deliveryId,
    eventType: event.eventType,
    checkoutId: event.intentId,
    providerOrderId: event.orderId,
    ...extras,
  };
}

export type WaffoWebhookResult = {
  status: "processed" | "ignored" | "duplicate" | "rejected" | "needs_reconciliation";
  /** False means the verified attempt could not be durably recorded. */
  durable: boolean;
  eventId: string;
  eventType: string;
  checkoutId?: string;
  providerOrderId?: string;
  listingId?: string;
  reason?: string;
};

function insertRejection(db: AppDb, event: NormalizedWaffoEvent, reason: string): void {
  db.prepare(`
    INSERT INTO waffo_webhook_rejections (
      delivery_id, event_type, event_id, payment_id, order_id, intent_id,
      payload_fingerprint, facts_fingerprint, reason, received_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    event.deliveryId,
    event.eventType,
    event.eventId,
    event.paymentId ?? null,
    event.orderId ?? null,
    event.intentId ?? null,
    event.payloadFingerprint,
    event.factsFingerprint,
    reason,
    new Date().toISOString(),
  );
}

function sameStoredEvent(row: Record<string, unknown>, event: NormalizedWaffoEvent): boolean {
  return row.payload_fingerprint === event.payloadFingerprint &&
    row.facts_fingerprint === event.factsFingerprint;
}

function existingLedger(
  db: AppDb,
  event: NormalizedWaffoEvent,
): Record<string, unknown> | undefined {
  const byDelivery = db.prepare("SELECT * FROM waffo_webhook_events WHERE delivery_id = ?").get(event.deliveryId) as Record<string, unknown> | undefined;
  if (byDelivery) return byDelivery;
  const byBusiness = db.prepare("SELECT * FROM waffo_webhook_events WHERE business_event_key = ?").get(`${event.eventType}:${event.eventId}`) as Record<string, unknown> | undefined;
  if (byBusiness) return byBusiness;
  if (event.paymentId) {
    const byPayment = db.prepare("SELECT * FROM waffo_webhook_events WHERE payment_id = ?").get(event.paymentId) as Record<string, unknown> | undefined;
    if (byPayment) return byPayment;
  }
  if (event.orderId) {
    const byOrder = db.prepare("SELECT * FROM waffo_webhook_events WHERE order_id = ?").get(event.orderId) as Record<string, unknown> | undefined;
    if (byOrder) return byOrder;
  }
  if (event.intentId) {
    const byIntent = db.prepare("SELECT * FROM waffo_webhook_events WHERE intent_id = ?").get(event.intentId) as Record<string, unknown> | undefined;
    if (byIntent) return byIntent;
  }
  return undefined;
}

function updateLedger(
  db: AppDb,
  deliveryId: string,
  outcome: WaffoWebhookResult["status"] | "processing",
  reason?: string,
  processedAt?: string,
): void {
  db.prepare(`
    UPDATE waffo_webhook_events
       SET outcome = ?, reason = ?, processed_at = ?
     WHERE delivery_id = ?
  `).run(outcome, reason ?? null, processedAt ?? null, deliveryId);
}

function insertLedger(db: AppDb, event: NormalizedWaffoEvent, intentId?: string): void {
  db.prepare(`
    INSERT INTO waffo_webhook_events (
      delivery_id, event_type, event_id, business_event_key, payment_id, order_id,
      intent_id, payload_fingerprint, facts_fingerprint, outcome, provider_mode,
      provider_store_id, provider_product_id, currency, provider_event_at, received_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'processing', ?, ?, ?, ?, ?, ?)
  `).run(
    event.deliveryId,
    event.eventType,
    event.eventId,
    `${event.eventType}:${event.eventId}`,
    event.paymentId ?? null,
    event.orderId ?? null,
    intentId ?? null,
    event.payloadFingerprint,
    event.factsFingerprint,
    event.eventMode ?? null,
    event.storeId ?? null,
    event.productId ?? null,
    event.currency ?? null,
    event.providerEventAt ?? null,
    new Date().toISOString(),
  );
}

/**
 * Resolve a uniqueness race after another instance committed the same
 * delivery/business/payment/order/intent. In particular, never run the
 * reconciliation fallback for an already-processed exact replay: doing so
 * would incorrectly downgrade a paid intent back to recovery state.
 */
function racedLedgerResult(
  db: AppDb,
  event: NormalizedWaffoEvent,
): WaffoWebhookResult | undefined {
  let existing: Record<string, unknown> | undefined;
  try {
    existing = existingLedger(db, event);
  } catch {
    return undefined;
  }
  if (!existing) return undefined;
  if (sameStoredEvent(existing, event)) {
    const outcome = existing.outcome;
    if (outcome === "processed") {
      return eventResult(event, "duplicate", { reason: "exact_replay" });
    }
    if (outcome === "ignored") {
      return eventResult(event, "ignored", { reason: existing.reason as string | undefined });
    }
    if (outcome === "rejected") {
      return eventResult(event, "rejected", { reason: existing.reason as string | undefined });
    }
    return eventResult(event, "needs_reconciliation", {
      reason: (existing.reason as string | undefined) ?? "concurrent_processing",
    });
  }
  try {
    const tx = db.transaction(() => {
      insertRejection(db, event, "event_reuse_mismatch");
    });
    tx();
  } catch {
    // A rejection is only acknowledged after its append-only audit exists.
    // The HTTP boundary turns durable=false into a retryable 503.
    return eventResult(event, "rejected", {
      reason: "event_reuse_mismatch",
      durable: false,
    });
  }
  return eventResult(event, "rejected", { reason: "event_reuse_mismatch" });
}

function placePaidListing(db: AppDb, intent: IntentRow, paidAt: string): Listing {
  const weekId = openWeekId(intent.week_id);
  ensureWeek(db, weekId);
  const licenseId = claimedLicense(intent.category, intent.license_id);
  const id = newListingId();
  try {
    db.prepare(`
      INSERT INTO listings (
        id, business, category, city, site_url, license_id, bid_usd, week_id,
        created_at, raised_at, clicks, hidden, hidden_reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, 0, NULL)
    `).run(
      id,
      intent.business,
      intent.category,
      intent.city,
      intent.site_url,
      licenseId,
      intent.target_bid_cents / 100,
      weekId,
      paidAt,
    );
  } catch (error) {
    if (/UNIQUE/i.test(error instanceof Error ? error.message : "")) {
      throw new PaymentError("already_listed", 409);
    }
    throw error;
  }
  return {
    id,
    business: intent.business,
    category: intent.category,
    city: intent.city,
    siteUrl: intent.site_url,
    licenseId,
    bidUsd: intent.target_bid_cents / 100,
    weekId,
    createdAt: paidAt,
    raisedAt: null,
    clicks: 0,
    hidden: false,
    hiddenReason: null,
  };
}

function settleIntent(db: AppDb, intent: IntentRow, paidAt: string): Listing {
  const existing = findListingByIdentity(db, {
    siteUrl: intent.site_url,
    category: intent.category,
    city: intent.city,
    weekId: openWeekId(intent.week_id),
  });
  if (intent.intent_kind === "place") {
    if (existing) throw new PaymentError("already_listed", 409);
    return placePaidListing(db, intent, paidAt);
  }
  if (!existing) throw new PaymentError("listing_not_found", 404);
  const currentCents = existing.bidUsd * 100;
  if (currentCents >= intent.target_bid_cents) {
    throw new PaymentError("stale_raise", 409);
  }
  if (currentCents + intent.charge_cents !== intent.target_bid_cents) {
    throw new PaymentError("raise_facts_mismatch", 409);
  }
  return applyRaise(db, existing, {
    newBidUsd: intent.target_bid_cents / 100,
    chargeUsd: intent.charge_cents / 100,
    business: intent.business,
    licenseId: intent.license_id,
    raisedAt: paidAt,
  });
}

function persistReconciliation(
  db: AppDb,
  event: NormalizedWaffoEvent,
  reason: string,
): boolean {
  const tx = db.transaction(() => {
    const existing = existingLedger(db, event);
    if (!existing) {
      insertLedger(db, event, event.intentId);
      updateLedger(db, event.deliveryId, "needs_reconciliation", reason, new Date().toISOString());
    } else if (existing.delivery_id === event.deliveryId && sameStoredEvent(existing, event)) {
      updateLedger(db, event.deliveryId, "needs_reconciliation", reason, new Date().toISOString());
    }
    if (event.intentId) markIntentState(db, event.intentId, "needs_reconciliation");
  });
  tx();
  const ledger = db.prepare(`
    SELECT payload_fingerprint, facts_fingerprint, outcome
      FROM waffo_webhook_events
     WHERE delivery_id = ?
  `).get(event.deliveryId) as {
    payload_fingerprint: string;
    facts_fingerprint: string;
    outcome: string;
  } | undefined;
  const intent = event.intentId ? readIntent(db, event.intentId) : undefined;
  return Boolean(
    ledger &&
      ledger.outcome === "needs_reconciliation" &&
      ledger.payload_fingerprint === event.payloadFingerprint &&
      ledger.facts_fingerprint === event.factsFingerprint &&
      (!event.intentId || intent?.state === "needs_reconciliation"),
  );
}

/**
 * Apply one already SDK-verified Waffo event. The transaction owns the
 * delivery ledger, immutable intent transition, checkout event, and listing.
 */
export function processWaffoWebhookEvent(
  event: WebhookEvent | Record<string, unknown>,
  db: AppDb,
  deliveryId?: string,
  env: PaymentEnv = process.env,
  rawBody?: string,
): WaffoWebhookResult {
  const normalized = normalizeWaffoEvent(event, deliveryId, rawBody);
  if (!normalized.eventId) {
    // Reject malformed signed payloads before any business-key lookup or
    // ledger insert. A delivery id is never a substitute for event.eventId.
    try {
      const tx = db.transaction(() => {
        insertRejection(db, normalized, "provider_identity_missing");
      });
      tx();
    } catch {
      // Do not acknowledge an undurable rejection. The canonical route maps
      // durable=false to a retryable 503.
      return eventResult(normalized, "rejected", {
        reason: "provider_identity_missing",
        durable: false,
      });
    }
    return eventResult(normalized, "rejected", { reason: "provider_identity_missing" });
  }
  const existing = existingLedger(db, normalized);
  const retryLedger =
    existing &&
    sameStoredEvent(existing, normalized) &&
    existing.outcome === "needs_reconciliation"
      ? existing
      : undefined;
  if (existing) {
    if (sameStoredEvent(existing, normalized) && !retryLedger) {
      return eventResult(normalized, "duplicate", { reason: "exact_replay" });
    }
    if (!retryLedger) {
      try {
        const tx = db.transaction(() => {
          insertRejection(db, normalized, "event_reuse_mismatch");
        });
        tx();
      } catch {
        return eventResult(normalized, "rejected", {
          reason: "event_reuse_mismatch",
          durable: false,
        });
      }
      return eventResult(normalized, "rejected", { reason: "event_reuse_mismatch" });
    }
  }

  const intent = normalized.intentId ? readIntent(db, normalized.intentId) : undefined;
  let result: WaffoWebhookResult;
  try {
    const tx = db.transaction(() => {
      // Re-read inside the transaction so a concurrent retry cannot use a
      // stale pre-lock state (for example, re-applying a row just paid by the
      // other instance).
      const currentIntent = normalized.intentId
        ? readIntent(db, normalized.intentId)
        : intent;
      const ledgerDeliveryId = retryLedger
        ? String(retryLedger.delivery_id)
        : normalized.deliveryId;
      if (!retryLedger) insertLedger(db, normalized, currentIntent?.intent_id);
      else updateLedger(db, ledgerDeliveryId, "processing");
      if (!currentIntent) {
        updateLedger(db, ledgerDeliveryId, "ignored", "unknown_intent", new Date().toISOString());
        result = eventResult(normalized, "ignored", { reason: "unknown_intent" });
        return;
      }
      const invalidReason = validateOrderCompleted(normalized, currentIntent, env);
      if (invalidReason) {
        const temporalCapture =
          invalidReason === "provider_timestamp_missing" ||
          invalidReason === "provider_timestamp_stale";
        if (temporalCapture) {
          // A signed capture with unusable causality may have been paid at the
          // provider. Preserve it for operator reconciliation rather than
          // silently leaving an open intent that can never be recovered.
          updateLedger(db, ledgerDeliveryId, "needs_reconciliation", invalidReason, new Date().toISOString());
          markIntentState(db, currentIntent.intent_id, "needs_reconciliation");
          result = eventResult(normalized, "needs_reconciliation", { reason: invalidReason });
        } else {
          updateLedger(db, ledgerDeliveryId, "ignored", invalidReason, new Date().toISOString());
          result = eventResult(normalized, "ignored", { reason: invalidReason });
        }
        return;
      }
      if (currentIntent.state === "paid") {
        // A concurrent retry may have committed the settlement while this
        // transaction waited on SQLite's write lock. Never mutate that paid
        // ledger row back to ignored.
        if (!retryLedger) {
          updateLedger(db, ledgerDeliveryId, "ignored", "intent_already_paid", new Date().toISOString());
        }
        result = eventResult(normalized, "duplicate", { reason: "intent_already_paid" });
        return;
      }
      if (
        currentIntent.state === "rejected" ||
        (currentIntent.state === "needs_reconciliation" && !retryLedger)
      ) {
        updateLedger(db, ledgerDeliveryId, "needs_reconciliation", "intent_not_open", new Date().toISOString());
        markIntentState(db, currentIntent.intent_id, "needs_reconciliation");
        result = eventResult(normalized, "needs_reconciliation", { reason: "intent_not_open" });
        return;
      }
      let listing: Listing;
      try {
        listing = settleIntent(db, currentIntent, normalized.providerEventAt!);
      } catch (error) {
        const reason = error instanceof PaymentError ? error.code : "settlement_failed";
        updateLedger(db, ledgerDeliveryId, "needs_reconciliation", reason, new Date().toISOString());
        markIntentState(db, currentIntent.intent_id, "needs_reconciliation");
        result = eventResult(normalized, "needs_reconciliation", { reason });
        return;
      }
      db.prepare(`
        UPDATE checkouts
           SET status = 'paid', listing_id = ?
         WHERE id = ? AND status = 'open'
      `).run(listing.id, currentIntent.intent_id);
      markIntentState(db, currentIntent.intent_id, "paid");
      updateLedger(db, ledgerDeliveryId, "processed", undefined, new Date().toISOString());
      result = eventResult(normalized, "processed", { listingId: listing.id });
    });
    tx();
  } catch (error) {
    const raced = racedLedgerResult(db, normalized);
    if (raced) return raced;
    // A captured payment whose rank write could not be committed is not a
    // cancellation. Preserve the immutable facts for a later operator retry.
    let durable = false;
    try {
      durable = persistReconciliation(
        db,
        normalized,
        error instanceof Error ? error.message : "transaction_failed",
      );
    } catch {
      // Do not claim a durable outcome when the fallback ledger write itself
      // failed. The HTTP boundary will return a retryable non-2xx response.
    }
    return eventResult(normalized, "needs_reconciliation", {
      reason: "transaction_failed",
      durable,
    });
  }
  return result!;
}



/** Verify a raw Waffo webhook with the explicit per-environment public key. */
export function verifyWaffoWebhook(
  rawBody: string,
  signature: string | null | undefined,
  env: PaymentEnv = process.env,
): WebhookEvent {
  const mode = requireWaffoMode(env);
  if (mode === "fixture") {
    throw new PaymentError("waffo_fixture_forbidden", 503);
  }
  const publicKey =
    mode === "waffo-test"
      ? envText(env, "WAFFO_WEBHOOK_TEST_PUBLIC_KEY")
      : envText(env, "WAFFO_WEBHOOK_PROD_PUBLIC_KEY");
  if (!publicKey) {
    throw new Error(`BLOCKED-SECRET: ${mode === "waffo-test" ? "WAFFO_WEBHOOK_TEST_PUBLIC_KEY" : "WAFFO_WEBHOOK_PROD_PUBLIC_KEY"}`);
  }
  return verifyWebhook(rawBody, signature, {
    environment: waffoEnvironment(mode),
    publicKey: publicKey.replace(/\\n/g, "\n"),
  }) as WebhookEvent;
}
