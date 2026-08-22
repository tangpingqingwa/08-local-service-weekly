import { getPolarPort } from "../../src/polar/fake";
import { handleCheckoutReturn } from "../../src/polar/port";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReturnPageProps = {
  searchParams?: Promise<{
    checkout?: string | string[];
    checkoutId?: string | string[];
    status?: string | string[];
  }>;
};

export default async function ReturnPage({ searchParams }: ReturnPageProps) {
  const params = (await searchParams) ?? {};
  let state: "paid" | "cancelled" | "unknown" = "unknown";
  let business: string | null = null;
  let bidUsd: number | null = null;

  try {
    const result = await handleCheckoutReturn(params, getPolarPort());
    state = result.state;
    business = result.listing?.business ?? null;
    bidUsd = result.listing?.bidUsd ?? null;
  } catch {
    state = "unknown";
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
