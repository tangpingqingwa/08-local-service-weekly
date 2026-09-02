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
  return parsed.hostname.toLowerCase().replace(/\.+$/, "");
}

const CONTROL_OR_BACKSLASH_RE = /[\u0000-\u001f\u007f\\]/;

function parseIpv4(host: string): readonly number[] | null {
  const octets = host.split(".");
  if (octets.length !== 4 || octets.some((octet) => !/^\d{1,3}$/.test(octet))) {
    return null;
  }

  const parsed = octets.map(Number);
  return parsed.every((octet) => octet >= 0 && octet <= 255) ? parsed : null;
}

function isUnsafeIpv4(host: string): boolean {
  const octets = parseIpv4(host);
  if (!octets) return false;

  const [first, second, third] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0 && third <= 2) ||
    (first === 192 && second === 168) ||
    (first === 198 && second >= 18 && second <= 19) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113) ||
    first >= 224
  );
}

function parseIpv6(host: string): readonly number[] | null {
  const value = host.startsWith("[") && host.endsWith("]")
    ? host.slice(1, -1)
    : host;
  if (!value.includes(":")) return null;

  const halves = value.split("::");
  if (halves.length > 2) return null;

  const parseHalf = (half: string): number[] | null => {
    if (!half) return [];
    const groups = half.split(":");
    const result: number[] = [];
    for (const group of groups) {
      if (group.includes(".")) {
        const octets = parseIpv4(group);
        if (!octets || result.length !== groups.length - 1) return null;
        result.push((octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/i.test(group)) return null;
      result.push(Number.parseInt(group, 16));
    }
    return result;
  };

  const left = parseHalf(halves[0]);
  const right = halves.length === 2 ? parseHalf(halves[1]) : [];
  if (!left || !right) return null;

  if (halves.length === 1) {
    return left.length === 8 ? left : null;
  }

  const zeroes = 8 - left.length - right.length;
  if (zeroes < 1) return null;
  return [...left, ...Array.from({ length: zeroes }, () => 0), ...right];
}

function isUnsafeIpv6(host: string): boolean {
  const groups = parseIpv6(host);
  if (!groups) return false;

  const first = groups[0];
  const allZero = groups.every((group) => group === 0);
  const loopback = groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1;
  const uniqueLocal = (first & 0xfe00) === 0xfc00;
  const linkLocal = (first & 0xffc0) === 0xfe80;
  const siteLocal = (first & 0xffc0) === 0xfec0;
  const multicast = (first & 0xff00) === 0xff00;
  const ipv4Mapped = groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;

  // Keep the mapped range blocked even when its embedded address is public;
  // the existing public-URL policy fails closed for this representation.
  return allZero || loopback || uniqueLocal || linkLocal || siteLocal || multicast || ipv4Mapped;
}

function isLocalOnlyHost(host: string): boolean {
  return (
    host === "localhost" ||
    host === "local" ||
    host === "internal" ||
    host === "ip6-loopback" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  );
}

function isUnsafeSiteHost(host: string): boolean {
  return isLocalOnlyHost(host) || isUnsafeIpv4(host) || isUnsafeIpv6(host);
}

function looksLikeBareSiteUrl(value: string): boolean {
  if (!value || /\s/.test(value) || /^[a-z][a-z\d+.-]*:\/\//i.test(value)) {
    return false;
  }

  const authority = value.match(/^[^/?#]*/)?.[0] ?? "";
  if (!authority) return false;

  try {
    const candidate = value.startsWith("//")
      ? new URL(`https:${value}`)
      : new URL(`https://${value}`);
    const host = hostnameOf(candidate);
    return (
      host === "localhost" ||
      host.includes(".") ||
      (host.startsWith("[") && host.endsWith("]"))
    );
  } catch {
    return false;
  }
}

function urlCandidate(value: string): string {
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("//") && !value.startsWith("///")) return `https:${value}`;

  // A host with a port (for example, example.com:8443) looks like a URI
  // scheme to the generic scheme parser. Let the host parser decide first so
  // those bare service URLs still receive the safe HTTPS default.
  if (looksLikeBareSiteUrl(value)) return `https://${value}`;
  return value;
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
 * add a safe https scheme for bare host input, drop fragment and tracking
 * query keys, and ignore trailing slash for identity. Chat, NSFW, unresolved
 * shorteners, and private or local-only destinations are 400.
 */
export function canonicalizeSiteUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new UrlError("invalid_listing", 400, "Site URL is required");
  }
  if (CONTROL_OR_BACKSLASH_RE.test(trimmed)) {
    throw new UrlError("invalid_listing", 400, "Site URL must be http(s)");
  }

  let parsed: URL;
  try {
    parsed = new URL(urlCandidate(trimmed));
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
  if (isUnsafeSiteHost(host)) {
    throw new UrlError(
      "invalid_listing",
      400,
      "Private or local-only destinations are not allowed",
    );
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
  const hostForUrl = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `https://${hostForUrl}${port}${path}${query ? `?${query}` : ""}`;
}
