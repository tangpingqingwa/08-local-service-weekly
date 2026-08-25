import type { Listing } from "../../src/db";
import { findListingByIdentity } from "../../src/listings";
import { getPolarPort } from "../../src/polar/fake";
import {
  handleCheckoutReturn,
  type CheckoutRecord,
  type PolarPort,
} from "../../src/polar/port";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReturnPageProps = {
  searchParams?: Promise<{
    checkout?: string | string[];
    checkoutId?: string | string[];
    status?: string | string[];
  }>;
};

function occupyingAfterAbandonedRaise(
  checkout: CheckoutRecord | null,
  port: PolarPort,
): Listing | null {
  if (checkout?.intent !== "raise") {
    return null;
  }
  const db = port.database?.();
  const weekId = checkout.listing.weekId;
  if (!db || !weekId) {
    return null;
  }
  const occupying = findListingByIdentity(db, {
    siteUrl: checkout.listing.siteUrl,
    category: checkout.listing.category,
    city: checkout.listing.city,
    weekId,
  });
  if (!occupying || occupying.hidden) {
    return null;
  }
  return occupying;
}

export default async function ReturnPage({ searchParams }: ReturnPageProps) {
  const params = (await searchParams) ?? {};
  let state: "paid" | "cancelled" | "unknown" = "unknown";
  let business: string | null = null;
  let bidUsd: number | null = null;
  let raiseChargeUsd: number | null = null;
  let occupying: Listing | null = null;

  try {
    const port = getPolarPort();
    const result = await handleCheckoutReturn(params, port);
    state = result.state;
    business = result.listing?.business ?? null;
    bidUsd = result.listing?.bidUsd ?? null;
    if (result.checkout?.intent === "raise") {
      raiseChargeUsd = result.checkout.amountUsd;
    }
    if (state === "cancelled") {
      occupying = occupyingAfterAbandonedRaise(result.checkout, port);
    }
  } catch {
    state = "unknown";
  }

  if (state === "cancelled" && occupying) {
    return (
      <main className="return-page" data-return="cancelled" data-raise-cancel="">
        <h1>Checkout cancelled</h1>
        <p className="raise-cancel" data-raise-cancel="">
          {occupying.business} still occupies at $<span data-occupy-bid-usd="">{occupying.bidUsd}</span>. An abandoned raise does not unlist.
        </p>
        <p>
          <a href="/">Back to the board</a>
        </p>
      </main>
    );
  }

  if (state === "cancelled") {
    return (
      <main className="return-page" data-return="cancelled">
        <h1>Checkout cancelled</h1>
        <p>No rank claimed. An abandoned checkout does not list.</p>
        <p>
          <a href="/">Back to the board</a>
        </p>
      </main>
    );
  }

  if (state === "paid" && raiseChargeUsd !== null) {
    return (
      <main className="return-page" data-return="paid" data-raise-return="">
        <h1>Payment received</h1>
        <p className="raise-return" data-raise-return="">
          Polar charged $<span data-raise-charge-usd="">{raiseChargeUsd}</span> — only the difference, not a full rebid.
        </p>
        <p>
          {business && bidUsd !== null
            ? `${business} is listed at $${bidUsd}. Rank is the bid.`
            : "The listing stays on the board at the rank that bid can take."}
        </p>
        <p>This page does not invent a rank before the payment settles.</p>
        <p>
          <a href="/">Back to the board</a>
        </p>
      </main>
    );
  }

  if (state === "paid") {
    return (
      <main className="return-page" data-return="paid">
        <h1>Payment received</h1>
        <p>
          {business && bidUsd !== null
            ? `${business} is listed at $${bidUsd}. Rank is the bid.`
            : "The listing is on the board at the rank that bid can take."}
        </p>
        <p>This page does not invent a rank before the payment settles.</p>
        <p>
          <a href="/">Back to the board</a>
        </p>
      </main>
    );
  }

  return (
    <main className="return-page" data-return="unknown">
      <h1>Checkout status unknown</h1>
      <p>No rank claimed. Unpaid checkout drafts never appear.</p>
      <p>
        <a href="/">Back to the board</a>
      </p>
    </main>
  );
}
