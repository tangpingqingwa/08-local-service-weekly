import { CATEGORIES, resolveCategory } from "../categories";
import { DEFAULT_CITY_SLUG } from "../constants";
import { resolveCity } from "../cities";
import type { PaymentError } from "./port";

function inputText(input: Record<string, unknown>, key: string): string {
  return typeof input[key] === "string" ? input[key].trim() : "";
}

function safeErrorCode(error: PaymentError): string {
  return /^[a-z][a-z0-9_]{0,63}$/.test(error.code)
    ? error.code
    : "payment_error";
}

/**
 * Keep native form failures inside a known public lane. User-supplied city and
 * category values are resolved against the catalog before entering a path, so
 * the redirect cannot become an open redirect or an unknown route.
 */
export function paymentFormErrorPath(
  input: Record<string, unknown>,
  error: PaymentError,
): string {
  const cityLookup = resolveCity(inputText(input, "city").toLowerCase());
  const categoryLookup = resolveCategory(inputText(input, "category"));
  const city = cityLookup.ok ? cityLookup.value.slug : DEFAULT_CITY_SLUG;
  const category = categoryLookup.ok
    ? categoryLookup.value.slug
    : CATEGORIES[0].slug;
  const code = safeErrorCode(error);
  return `/c/${encodeURIComponent(city)}/${encodeURIComponent(category)}?error=${encodeURIComponent(code)}#claim`;
}
