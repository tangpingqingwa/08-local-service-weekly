import { readFileSync } from "node:fs";
import { isIP } from "node:net";

import { PaymentError, type PaymentEnv } from "./port";

export const WAFFO_API_BASE = "https://api.waffo.ai";

export type WaffoMode = "fixture" | "waffo-test" | "waffo-prod";

const MODE_KEYS = ["PAYMENT_MODE", "WAFFO_MODE", "PAYMENT_PROVIDER_MODE"] as const;

function envText(env: PaymentEnv, key: string): string | undefined {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

/**
 * Deployment markers are an independent safety boundary from PAYMENT_MODE.
 * A fixture can never be selected by a production build/server alias, even
 * when NODE_ENV was omitted or rewritten by the host.
 */
export function isProductionLike(env: PaymentEnv = process.env): boolean {
  const marker = (key: string, expected: string): boolean =>
    envText(env, key)?.toLowerCase() === expected;
  return (
    marker("NODE_ENV", "production") ||
    marker("VERCEL_ENV", "production") ||
    marker("APP_ENV", "production") ||
    marker("DEPLOY_ENV", "production") ||
    marker("BUILD_ENV", "production") ||
    marker("NEXT_PHASE", "phase-production-server") ||
    marker("NEXT_PHASE", "phase-production-build")
  );
}

/**
 * The payment mode is deliberately explicit. Historical provider variables are
 * ignored; neither a credential nor NODE_ENV may select a provider.
 */
export function waffoMode(env: PaymentEnv = process.env): WaffoMode | undefined {
  const configured = MODE_KEYS
    .map((key) => envText(env, key))
    .filter((value): value is string => Boolean(value));
  if (configured.length === 0 || new Set(configured).size !== 1) return undefined;
  const mode = configured[0];
  return mode === "fixture" || mode === "waffo-test" || mode === "waffo-prod"
    ? mode
    : undefined;
}

export function isWaffoLive(env: PaymentEnv = process.env): boolean {
  const mode = waffoMode(env);
  return mode === "waffo-test" || mode === "waffo-prod";
}

export function waffoEnvironment(mode: WaffoMode): "test" | "prod" {
  if (mode === "waffo-test") return "test";
  if (mode === "waffo-prod") return "prod";
  throw new PaymentError("waffo_not_live", 503, "fixture mode has no provider environment");
}

export function requireWaffoMode(env: PaymentEnv = process.env): WaffoMode {
  const configured = MODE_KEYS
    .map((key) => envText(env, key))
    .filter((value): value is string => Boolean(value));
  if (new Set(configured).size > 1) {
    throw new PaymentError(
      "waffo_mode_conflict",
      503,
      "Configure exactly one consistent Waffo payment mode",
    );
  }
  const mode = waffoMode(env);
  if (!mode) {
    throw new PaymentError(
      "waffo_mode_required",
      503,
      "Set PAYMENT_MODE=fixture, PAYMENT_MODE=waffo-test, or PAYMENT_MODE=waffo-prod",
    );
  }
  return mode;
}

export function waffoMerchantId(env: PaymentEnv = process.env): string | undefined {
  return envText(env, "WAFFO_MERCHANT_ID");
}

export function waffoStoreId(env: PaymentEnv = process.env): string | undefined {
  return envText(env, "WAFFO_STORE_ID");
}

export function waffoProductId(env: PaymentEnv = process.env): string | undefined {
  return envText(env, "WAFFO_PRODUCT_ID");
}

function requireSingleConfiguredId(
  env: PaymentEnv,
  key: "WAFFO_MERCHANT_ID" | "WAFFO_STORE_ID" | "WAFFO_PRODUCT_ID",
  code: string,
): string {
  const value = envText(env, key);
  const prefix = key === "WAFFO_MERCHANT_ID" ? "MER" : key === "WAFFO_STORE_ID" ? "STO" : "PROD";
  if (!value || !new RegExp(`^${prefix}_[A-Za-z0-9]{22}$`).test(value)) {
    throw new PaymentError(code, 503, `BLOCKED-SECRET: ${key}`);
  }
  return value;
}

export function requireWaffoMerchantId(env: PaymentEnv = process.env): string {
  return requireSingleConfiguredId(env, "WAFFO_MERCHANT_ID", "waffo_merchant_missing");
}

export function requireWaffoStoreId(env: PaymentEnv = process.env): string {
  return requireSingleConfiguredId(env, "WAFFO_STORE_ID", "waffo_store_missing");
}

/** Exactly one product is allowed: priceSnapshot supplies the dynamic price. */
export function requireWaffoProductId(env: PaymentEnv = process.env): string {
  return requireSingleConfiguredId(env, "WAFFO_PRODUCT_ID", "waffo_product_missing");
}

function keyText(env: PaymentEnv): string | undefined {
  const inline = envText(env, "WAFFO_PRIVATE_KEY");
  if (inline) return inline.replace(/\\n/g, "\n");
  const file = envText(env, "WAFFO_PRIVATE_KEY_FILE");
  if (!file) return undefined;
  try {
    return readFileSync(file, "utf8").trim();
  } catch {
    throw new Error("BLOCKED-SECRET: WAFFO_PRIVATE_KEY_FILE");
  }
}

export function requireWaffoPrivateKey(env: PaymentEnv = process.env): string {
  const key = keyText(env);
  if (!key) {
    throw new Error("BLOCKED-SECRET: WAFFO_PRIVATE_KEY");
  }
  return key;
}

export function waffoApiBase(env: PaymentEnv = process.env): string {
  return (envText(env, "WAFFO_API_BASE") ?? WAFFO_API_BASE).replace(/\/+$/, "");
}

export function waffoPublicBaseUrl(env: PaymentEnv = process.env): string {
  return (
    envText(env, "WAFFO_PUBLIC_BASE_URL") ??
    envText(env, "PUBLIC_BASE_URL") ??
    "http://127.0.0.1:3000"
  ).replace(/\/$/, "");
}

export function waffoWebhookPublicKey(
  env: PaymentEnv = process.env,
  mode: WaffoMode = requireWaffoMode(env),
): string {
  const key =
    mode === "waffo-test"
      ? envText(env, "WAFFO_WEBHOOK_TEST_PUBLIC_KEY")
      : mode === "waffo-prod"
        ? envText(env, "WAFFO_WEBHOOK_PROD_PUBLIC_KEY")
        : undefined;
  if (!key) {
    throw new Error(
      `BLOCKED-SECRET: ${mode === "waffo-test" ? "WAFFO_WEBHOOK_TEST_PUBLIC_KEY" : "WAFFO_WEBHOOK_PROD_PUBLIC_KEY"}`,
    );
  }
  return key.replace(/\\n/g, "\n");
}

function assertHttpsPublicUrl(env: PaymentEnv): void {
  const configured = envText(env, "WAFFO_PUBLIC_BASE_URL") ?? envText(env, "PUBLIC_BASE_URL");
  if (!configured) {
    throw new Error("BLOCKED-SECRET: WAFFO_PUBLIC_BASE_URL");
  }
  try {
    const parsed = new URL(configured);
    const authority = /^https:\/\/([^/?#]+)/i.exec(configured)?.[1] ?? "";
    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
    const ipVersion = isIP(host);
    const privateIpv4 =
      ipVersion === 4 &&
      (() => {
        const octets = host.split(".").map(Number);
        return (
          octets[0] === 0 ||
          octets[0] === 10 ||
          octets[0] === 127 ||
          (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) ||
          (octets[0] === 169 && octets[1] === 254) ||
          (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
          (octets[0] === 192 && octets[1] === 168)
        );
      })();
    const privateIpv6 = ipVersion === 6 && (
      host === "::" ||
      host === "::1" ||
      // IPv4-mapped IPv6 literals can otherwise smuggle loopback/private
      // addresses past the IPv4-only range checks. Fail closed for the whole
      // mapped range; a public URL has no reason to use this representation.
      host.startsWith("::ffff:") ||
      /^(fc|fd)[0-9a-f]/i.test(host) ||
      /^fe[89ab][0-9a-f]/i.test(host)
    );
    const localHostname =
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host.endsWith(".local") ||
      host.endsWith(".internal") ||
      host === "ip6-loopback";
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.port ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash ||
      authority.includes(":") ||
      !host ||
      privateIpv4 ||
      privateIpv6 ||
      localHostname
    ) {
      throw new Error("invalid public URL");
    }
  } catch {
    throw new Error("BLOCKED-SECRET: WAFFO_PUBLIC_BASE_URL");
  }
}

function validateWaffoApiBase(env: PaymentEnv, mode: WaffoMode): void {
  const configured = waffoApiBase(env);
  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    throw new PaymentError("waffo_api_base_invalid", 503, "BLOCKED-CONFIG: WAFFO_API_BASE");
  }
  const official = new URL(WAFFO_API_BASE);
  const authority = /^https:\/\/([^/?#]+)/i.exec(configured)?.[1] ?? "";
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    authority.includes(":") ||
    parsed.origin !== official.origin
  ) {
    throw new PaymentError(
      "waffo_api_base_invalid",
      503,
      `BLOCKED-CONFIG: WAFFO_API_BASE must be ${WAFFO_API_BASE}`,
    );
  }
}

/**
 * Validate all live configuration before constructing the SDK or making a
 * network call. An injected database is allowed for offline test fixtures;
 * production always requires a durable DATABASE_PATH from the environment.
 */
export function validateWaffoConfiguration(
  env: PaymentEnv = process.env,
  options: { databaseInjected?: boolean } = {},
): WaffoMode {
  const mode = requireWaffoMode(env);
  if (mode === "fixture") {
    // Fixture is an explicitly selected local/offline adapter. It is never
    // permitted in a production process, including when stale compatibility
    // legacy provider flags are present.
    if (isProductionLike(env)) {
      throw new PaymentError("waffo_fixture_forbidden", 503, "fixture mode is forbidden in production");
    }
    return mode;
  }

  requireWaffoMerchantId(env);
  requireWaffoStoreId(env);
  requireWaffoProductId(env);
  requireWaffoPrivateKey(env);
  validateWaffoApiBase(env, mode);
  assertHttpsPublicUrl(env);
  waffoWebhookPublicKey(env, mode);

  const databasePath = envText(env, "DATABASE_PATH");
  if (
    (mode === "waffo-prod" ||
      (mode === "waffo-test" && isProductionLike(env))) &&
    (!databasePath || databasePath === ":memory:")
  ) {
    throw new Error("BLOCKED-SECRET: DATABASE_PATH");
  }
  if (mode === "waffo-test" && (!databasePath || databasePath === ":memory:") && !options.databaseInjected) {
    throw new Error("BLOCKED-SECRET: DATABASE_PATH");
  }
  return mode;
}
