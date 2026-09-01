import type { AppDb, Listing } from "./db";
import { getListingById } from "./listings";
import { canonicalizeSiteUrl, UrlError } from "./urls";

export const GO_PATH = "/go" as const;

export type ClickErrorCode = "listing_not_found";

export class ClickError extends Error {
  constructor(
    readonly code: ClickErrorCode,
    readonly httpStatus: number = 404,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "ClickError";
  }
}

export type ClickHop = {
  listing: Listing;
  url: string;
};

export function listingClickPath(listingId: string): string {
  return `${GO_PATH}/${listingId}`;
}

/** Outbound hop is the cleaned stored URL. We never add a query string. */
export function clickDestinationUrl(siteUrl: string): string {
  try {
    return canonicalizeSiteUrl(siteUrl);
  } catch (error) {
    if (error instanceof UrlError) {
      throw new ClickError("listing_not_found", 404);
    }
    throw error;
  }
}

/**
 * Increment the public counter by 1, then return the cleaned redirect.
 * Never seeds, estimates, or copies another listing's count.
 */
export function incrementPublicClick(db: AppDb, listingId: string): ClickHop {
  const id = listingId.trim();
  const listing = id ? getListingById(db, id) : undefined;
  if (!listing || listing.hidden) {
    throw new ClickError("listing_not_found", 404);
  }
  const url = clickDestinationUrl(listing.siteUrl);
  const result = db
    .prepare(
      "UPDATE listings SET clicks = clicks + 1 WHERE id = ? AND hidden = 0",
    )
    .run(listing.id);
  if (result.changes !== 1) {
    throw new ClickError("listing_not_found", 404);
  }
  const updated = getListingById(db, listing.id);
  if (!updated || updated.hidden) {
    throw new ClickError("listing_not_found", 404);
  }
  return { listing: updated, url };
}
