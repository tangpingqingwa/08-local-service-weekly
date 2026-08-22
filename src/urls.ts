/** SPEC §7. Clean before store. No network. Fixture tests supply the final URL. */

export type UrlErrorCode =
  | "chat_link"
  | "nsfw"
  | "url_shortener"
  | "invalid_listing";

export class UrlError extends Error {
  constructor(
    readonly code: UrlErrorCode,
    readonly httpStatus: number = 400,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "UrlError";
  }
}

/** Query keys dropped on accept. `utm_*` is prefix-matched. */
export const TRACKING_QUERY_KEYS: readonly string[] = [
  "gclid",
  "fbclid",
  "ref",
  "ref_id",
  "affiliate",
  "via",
  "mc_cid",
  "mc_eid",
];

const TRACKING_KEY_SET = new Set(
  TRACKING_QUERY_KEYS.map((key) => key.toLowerCase()),
);

/** Chat / invite hosts. Subdomains match. `discord.com` only `/invite`. */
export const CHAT_HOSTS: readonly string[] = [
  "t.me",
  "telegram.org",
  "telegram.me",
  "telegram.com",
  "telegram.dog",
  "wa.me",
  "whatsapp.com",
  "discord.gg",
  "m.me",
  "signal.me",
];

/** Operator adult-host list. Subdomains match. */
export const NSFW_HOSTS: readonly string[] = [
  "onlyfans.com",
  "fansly.com",
  "pornhub.com",
  "pornhub.org",
  "pornhubpremium.com",
  "xvideos.com",
  "xnxx.com",
  "xhamster.com",
  "chaturbate.com",
  "stripchat.com",
  "manyvids.com",
  "redtube.com",
  "youporn.com",
  "brazzers.com",
  "adultfriendfinder.com",
  "spankbang.com",
];

/** Path segments that mark an adult listing (BUILD / SPEC §7). */
export const NSFW_PATH_KEYWORDS: readonly string[] = [
  "porn",
  "xxx",
  "nsfw",
  "onlyfans",
  "fansly",
];

const NSFW_PATH_RE = new RegExp(
  `(?:^|/)(?:${NSFW_PATH_KEYWORDS.join("|")})(?:/|$)`,
  "i",
);

/** Unresolved shorteners are not stored. Live one-hop follow is out of this PR. */
export const SHORTENER_HOSTS: readonly string[] = [
  "bit.ly",
  "t.co",
  "tinyurl.com",
  "goo.gl",
  "ow.ly",
  "buff.ly",
  "is.gd",
  "cutt.ly",
  "rb.gy",
  "lnkd.in",
  "rebrand.ly",
];

function hostMatches(host: string, listed: string): boolean {
  return host === listed || host.endsWith(`.${listed}`);
}

function hostnameOf(parsed: URL): string {
  return parsed.hostname.toLowerCase().replace(/\.$/, "");
}

export function isTrackingQueryKey(key: string): boolean {
  const lowered = key.toLowerCase();
  return lowered.startsWith("utm_") || TRACKING_KEY_SET.has(lowered);
}

export function isChatUrl(parsed: URL): boolean {
  const host = hostnameOf(parsed);
  if (CHAT_HOSTS.some((listed) => hostMatches(host, listed))) {
    return true;
  }
  if (hostMatches(host, "discord.com") || hostMatches(host, "discordapp.com")) {
    const path = parsed.pathname.toLowerCase();
    return path === "/invite" || path.startsWith("/invite/");
  }
  return false;
}

export function isNsfwUrl(parsed: URL): boolean {
  const host = hostnameOf(parsed);
  if (NSFW_HOSTS.some((listed) => hostMatches(host, listed))) {
    return true;
  }
  if (/(^|\.)(porn|xxx|nsfw|onlyfans|fansly)(\.|$)/i.test(host)) {
    return true;
  }
  return NSFW_PATH_RE.test(parsed.pathname);
}

export function isShortenerHost(host: string): boolean {
  const lowered = host.toLowerCase().replace(/\.$/, "");
  return SHORTENER_HOSTS.some((listed) => hostMatches(lowered, listed));
}

/**
 * Require https (http → https when the host is unchanged), lowercase host,
 * drop fragment and tracking query keys, ignore trailing slash for identity.
 * Chat, NSFW, and unresolved shorteners are 400.
 */
export function canonicalizeSiteUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new UrlError("invalid_listing", 400, "Site URL is required");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new UrlError("invalid_listing", 400, "Site URL must be http(s)");
  }

  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== "http:" && protocol !== "https:") {
    throw new UrlError("invalid_listing", 400, "Site URL must be http(s)");
  }

  const host = hostnameOf(parsed);
  if (!host) {
    throw new UrlError("invalid_listing", 400, "Site URL host is required");
  }

  if (isShortenerHost(host)) {
    throw new UrlError("url_shortener", 400, "URL shorteners are not stored");
  }
  if (isChatUrl(parsed)) {
    throw new UrlError("chat_link", 400, "chat and invite links are not allowed");
  }
  if (isNsfwUrl(parsed)) {
    throw new UrlError("nsfw", 400, "adult URLs are not allowed");
  }

  const kept = new URLSearchParams();
  for (const [key, value] of parsed.searchParams.entries()) {
    if (!isTrackingQueryKey(key)) {
      kept.append(key, value);
    }
  }

  let path = parsed.pathname || "/";
  if (path === "/") {
    path = "";
  } else {
    path = path.replace(/\/+$/, "");
  }

  const dropDefaultPort =
    parsed.port === "443" || parsed.port === "80" || parsed.port === "";
  const port = dropDefaultPort ? "" : `:${parsed.port}`;
  const query = kept.toString();
  const hostForUrl = host.includes(":") ? `[${host}]` : host;
  return `https://${hostForUrl}${port}${path}${query ? `?${query}` : ""}`;
}
