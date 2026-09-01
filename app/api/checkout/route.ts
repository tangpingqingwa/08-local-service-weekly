import { NextResponse } from "next/server";
import { getPaymentPort } from "../../../src/billing/fake";
import { paymentFormErrorPath } from "../../../src/billing/form-error";
import { parseListingDraft, PaymentError } from "../../../src/billing/port";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  let input: Record<string, unknown> = {};
  try {
    input = await readInput(request);
    const listing = parseListingDraft(input);
    const started = await getPaymentPort().createCheckout({
      amountUsd: listing.bidUsd,
      listing,
    });
    if (wantsJson(request)) {
      return Response.json({
        status: started.status,
        id: started.id,
        listingId: started.listingId ?? null,
        url: started.url,
      });
    }
    return NextResponse.redirect(new URL(started.url, request.url), 303);
  } catch (error) {
    if (error instanceof PaymentError) {
      if (wantsJson(request)) {
        return Response.json({ error: error.code }, { status: error.httpStatus });
      }
      return NextResponse.redirect(
        new URL(paymentFormErrorPath(input, error), request.url),
        303,
      );
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
      throw new PaymentError("invalid_listing", 400);
    }
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw new PaymentError("invalid_listing", 400);
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
