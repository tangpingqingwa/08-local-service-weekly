import ReturnPage from "../../return/page";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CheckoutCompleteProps = {
  searchParams?: Promise<{
    intent?: string | string[];
  }>;
};

/**
 * The Waffo success URL is a read-only view. It passes the local intent id to
 * the same return renderer; no browser parameter can settle or cancel it.
 */
export default async function CheckoutCompletePage({
  searchParams,
}: CheckoutCompleteProps) {
  const params = (await searchParams) ?? {};
  const intent = Array.isArray(params.intent) ? params.intent[0] : params.intent;
  return ReturnPage({
    searchParams: Promise.resolve(intent ? { checkout: intent } : {}),
  });
}
