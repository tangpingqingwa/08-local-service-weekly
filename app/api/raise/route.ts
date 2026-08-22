import { NextResponse } from "next/server";
import { raiseListing } from "../../../src/listings";
import { currentWeekId, getPolarPort } from "../../../src/polar/fake";
import { parseListingDraft, PolarError } from "../../../src/polar/port";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const input = await readInput(request);
    const listing = parseListingDraft(input);
    const started = await raiseListing(
      { ...listing, weekId: listing.weekId ?? currentWeekId() },
      getPolarPort(),
    );
    if (wantsJson(request)) {
      return Response.json({
        status: started.status,
        id: started.checkoutId,
        listingId: started.listing?.id ?? null,
        bidUsd: started.listing?.bidUsd ?? started.quote.newBidUsd,
        chargedUsd: started.quote.chargeUsd,
        createdAt: started.listing?.createdAt ?? null,
        url: started.url,
      });
    }
    return NextResponse.redirect(new URL(started.url, request.url), 303);
  } catch (error) {
    if (error instanceof PolarError) {
      return Response.json({ error: error.code }, { status: error.httpStatus });
    }
    throw error;
  }
}

function wantsJson(request: Request): boolean {
  const accept = request.headers.get("accept") ?? "";
  const contentType = request.headers.get("content-type") ?? "";
  return (
    accept.includes("application/json") ||
    contentType.includes("application/json")
  );
}

async function readInput(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new PolarError("invalid_listing", 400);
    }
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw new PolarError("invalid_listing", 400);
    }
    return body as Record<string, unknown>;
  }
  const form = await request.formData();
  const input: Record<string, unknown> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") {
      input[key] = value;
    }
  }
  return input;
}
