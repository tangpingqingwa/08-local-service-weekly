type FormErrorCopy = {
  title: string;
  detail: string;
};

const COPY: Record<string, FormErrorCopy> = {
  bid_too_low: {
    title: "Bid needs to be higher",
    detail: "Use a whole-dollar bid of at least $5 and try the form again.",
  },
  bid_not_integer: {
    title: "Use whole dollars",
    detail: "Enter a whole-dollar amount and try the form again.",
  },
  bid_too_high: {
    title: "Bid is above the limit",
    detail: "Choose an amount no higher than $999,999 and try the form again.",
  },
  invalid_listing: {
    title: "Check the listing fields",
    detail: "Complete the required fields with a valid business and site URL, then try again.",
  },
  license_required: {
    title: "A claimed license id is required",
    detail: "Add the claimed license id for this category and try the form again. It is not verified here.",
  },
  chat_link: {
    title: "Use a public site URL",
    detail: "Chat and invite links cannot be listed. Enter the business site and try again.",
  },
  nsfw: {
    title: "That site cannot be listed",
    detail: "Enter a public, non-adult site URL and try the form again.",
  },
  url_shortener: {
    title: "Use the final site URL",
    detail: "Short links cannot be stored. Enter the business site URL and try again.",
  },
  city_unknown: {
    title: "Choose a listed city",
    detail: "That city is not available yet. Choose a listed city and try again.",
  },
  category_unknown: {
    title: "Choose a listed category",
    detail: "That service is not available yet. Choose a listed service and try again.",
  },
  listing_hidden: {
    title: "This listing is hidden",
    detail: "A hidden listing cannot be raised. Return to the edition to choose another lane.",
  },
  listing_not_found: {
    title: "The listing was not found",
    detail: "Return to the edition and choose the lane again before trying the form.",
  },
  already_listed: {
    title: "This site is already listed",
    detail: "Return to the lane to raise the existing listing instead of starting another one.",
  },
  week_closed: {
    title: "This lane is closed",
    detail: "Return to the edition and choose an open lane before trying again.",
  },
  waffo_checkout_rejected: {
    title: "Checkout did not start",
    detail: "No new rank was added. Check the fields and try the form again.",
  },
  waffo_checkout_unknown: {
    title: "Payment status needs checking",
    detail: "Payment has not been confirmed. No new rank is shown until confirmation arrives. Check the return page before trying again.",
  },
  waffo_not_live: {
    title: "Payments are not available",
    detail: "Checkout is temporarily unavailable. Return to the edition and try again later.",
  },
  waffo_mode_required: {
    title: "Payments are not configured",
    detail: "No checkout was started. Return to the edition and try again later.",
  },
  waffo_mode_conflict: {
    title: "Payments are not configured",
    detail: "No checkout was started. Return to the edition and try again later.",
  },
  payment_error: {
    title: "The checkout could not be completed",
    detail: "No new rank is shown. Check the form and try again, or check the return page if payment status is unclear.",
  },
};

export function FormErrorNotice({ code }: { code: string }) {
  const safeCode = Object.prototype.hasOwnProperty.call(COPY, code)
    ? code
    : "payment_error";
  const copy = COPY[safeCode];
  return (
    <aside
      className="form-error"
      data-form-error={safeCode}
      role="alert"
      aria-live="polite"
    >
      <p className="error-status">No new rank was added</p>
      <h2>{copy.title}</h2>
      <p>{copy.detail}</p>
      <p className="form-error-actions">
        <a href="#claim">Return to the form</a>
        <a href="/return">Check payment status</a>
        <a href="/">Back to the edition</a>
      </p>
    </aside>
  );
}
