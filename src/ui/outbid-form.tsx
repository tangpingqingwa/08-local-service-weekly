"use client";

import { useEffect, useState } from "react";
import {
  CATEGORIES,
  categoryRequiresLicense,
  type CategorySlug,
} from "../categories";
import { CITIES } from "../cities";
import { MAX_BID_USD, MIN_BID_USD } from "../constants";

type OutbidFormProps = {
  city?: string;
  category?: CategorySlug;
  lockCity?: boolean;
  lockCategory?: boolean;
  emptyPaper?: boolean;
  topBidUsd?: number;
  hero?: boolean;
  /** Explicitly choose a new listing or same-identity raise flow. */
  mode?: "new" | "raise";
};

export function minimumBidForForm(
  newListing: boolean,
  topBidUsd?: number,
): number {
  if (
    newListing ||
    topBidUsd === undefined ||
    !Number.isSafeInteger(topBidUsd) ||
    topBidUsd < MIN_BID_USD
  ) {
    return MIN_BID_USD;
  }
  return topBidUsd + 1;
}

export function clampAmount(value: number, minimumBid = MIN_BID_USD): number {
  if (!Number.isFinite(value)) {
    return minimumBid > MAX_BID_USD ? MAX_BID_USD : minimumBid;
  }
  return Math.min(MAX_BID_USD, Math.max(minimumBid, Math.trunc(value)));
}

function OccupiedCheckoutCopy({
  amount,
  topBidUsd,
}: {
  amount: number;
  topBidUsd?: number;
}) {
  const takesLead = topBidUsd !== undefined && amount > topBidUsd;
  const raiseChargeUsd =
    topBidUsd !== undefined && takesLead ? amount - topBidUsd : 0;

  return (
    <p className="claim-note" data-raise-difference="">
      Only a listing with this exact site URL in this service desk can raise.
      Paying less than #1 still lists at the rank that bid can take. Rank is
      the bid.{" "}
      {takesLead ? (
        <span className="raise-charge" data-raise-charge="" data-current-usd={topBidUsd}>
          {"Raise charge: " + "$" + raiseChargeUsd} — only the difference,
          not a full rebid.
        </span>
      ) : (
        <span className="raise-charge" data-raise-charge="">
          A raise charges only the difference, not a full rebid.
        </span>
      )}{" "}
      A new listing is charged its full bid. An incomplete checkout stays off
      the board. New listings use Claim rank on the home paper.
    </p>
  );
}

export function OutbidForm({
  city,
  category,
  lockCity = false,
  lockCategory = false,
  emptyPaper = false,
  topBidUsd,
  hero = false,
  mode,
}: OutbidFormProps) {
  const isNewListing = mode ? mode === "new" : emptyPaper;
  const defaultCity = city ?? CITIES[0]?.slug ?? "london";
  const defaultCategory = category ?? CATEGORIES[0]?.slug ?? "movers";
  const minimumBid = minimumBidForForm(isNewListing, topBidUsd);
  const [amount, setAmount] = useState(
    clampAmount(minimumBid, minimumBid),
  );
  const [selectedCity, setSelectedCity] = useState(defaultCity);
  const [selectedCategory, setSelectedCategory] = useState<CategorySlug | "">(
    lockCategory ? defaultCategory : category ?? "",
  );
  const [business, setBusiness] = useState("");
  const [siteUrl, setSiteUrl] = useState("");
  const [licenseId, setLicenseId] = useState("");

  useEffect(() => {
    setAmount((current) => clampAmount(current, minimumBid));
  }, [minimumBid]);

  const activeCategory = selectedCategory || defaultCategory;
  const categoryInfo = CATEGORIES.find((item) => item.slug === activeCategory);
  const licenseNeeded =
    Boolean(selectedCategory) && categoryRequiresLicense(activeCategory);
  const formAction = isNewListing ? "/api/checkout" : "/api/raise";
  const amountIsValid =
    Number.isSafeInteger(amount) &&
    minimumBid <= MAX_BID_USD &&
    amount >= minimumBid &&
    amount <= MAX_BID_USD;
  const formId =
    (hero ? "claim-desk-form" : "claim-" + (isNewListing ? "new" : "raise")) +
    "-" +
    defaultCity +
    "-" +
    activeCategory;
  const canSubmit =
    amountIsValid &&
    business.trim().length > 0 &&
    siteUrl.trim().length > 0 &&
    selectedCategory.length > 0 &&
    (!licenseNeeded || licenseId.trim().length >= 2);

  function bump(delta: number): void {
    setAmount((current) => clampAmount(current + delta, minimumBid));
  }

  return (
    <section
      className={isNewListing ? "claim claim-form" : "claim claim-form later-claim"}
      id="claim"
      data-slot={hero ? "claim-hero" : "claim-support"}
      data-form-state={isNewListing ? "new" : "raise"}
      data-form-mode={isNewListing ? "new" : "raise"}
      data-amount-floor={minimumBid}
      {...(hero ? { "data-hero-form": "" } : {})}
      {...(isNewListing
        ? { "aria-label": "Claim #1", "data-new-listing": "" }
        : {
            "aria-label": "Raise an existing listing",
            "data-later-claim": "",
            "data-raise-only": "",
          })}
    >
      <div className="claim-desk-heading">
        <p className="claim-kicker">Want ad desk</p>
        <h2 data-slot="claim-heading">
          <span>{isNewListing ? "Claim #1 for" : "Raise your listing to"}</span>
          <span className="amount-stepper" data-slot="amount-stepper">
            <button
              type="button"
              className="step"
              aria-label="Decrease bid by one dollar"
              disabled={amount <= minimumBid}
              onClick={() => bump(-1)}
            >
              −
            </button>
            <label className="amount-field">
              <span className="sr-only">Amount in dollars</span>
              $
              <input
                form={formId}
                name="amount"
                type="number"
                inputMode="numeric"
                pattern="[0-9]*"
                min={minimumBid}
                max={MAX_BID_USD}
                step={1}
                required
                style={{
                  width: `${Math.max(2.25, String(amount).length + 0.65)}ch`,
                }}
                value={amount}
                onChange={(event) => {
                  const next = Number(event.target.value.replace(/[^\d]/g, ""));
                  setAmount(clampAmount(next || minimumBid, minimumBid));
                }}
              />
            </label>
            <button
              type="button"
              className="step"
              aria-label="Increase bid by one dollar"
              disabled={amount >= MAX_BID_USD || minimumBid > MAX_BID_USD}
              onClick={() => bump(1)}
            >
              +
            </button>
          </span>
        </h2>
      </div>
      {isNewListing ? (
        <p className="claim-note" data-new-listing-note="">
          New listing: choose a service desk. New spots start at {"$" + MIN_BID_USD}.
          Rank is the bid. If this site is already listed, use that desk&apos;s
          Outbid form to raise the same identity. An incomplete checkout stays
          off the paper.
        </p>
      ) : (
        <OccupiedCheckoutCopy amount={amount} topBidUsd={topBidUsd} />
      )}
      <form
        id={formId}
        method="post"
        action={formAction}
        data-bid-form=""
        data-checkout-intent={isNewListing ? "place" : "raise"}
        data-amount-floor={minimumBid}
        data-city={lockCity ? defaultCity : selectedCity}
        data-category={selectedCategory || activeCategory}
        data-submit-ready={canSubmit ? "true" : "false"}
        data-slot="claim-form"
      >
        <div className="listing-identity" data-listing-identity="" data-slot="listing-identity">
          <div className="fields want-ad-fields" data-slot="claim-fields">
            <label className="business-field" data-slot="business-field">
              Business
              <input
                name="business"
                maxLength={80}
                required
                autoComplete="organization"
                placeholder="Business name"
                value={business}
                onChange={(event) => setBusiness(event.target.value)}
              />
            </label>
            {lockCity ? (
              <label className="city-field locked-field" data-slot="city-field">
                City
                <span>
                  {CITIES.find((item) => item.slug === defaultCity)?.display ??
                    defaultCity}
                </span>
                <input type="hidden" name="city" value={defaultCity} />
              </label>
            ) : (
              <label className="city-field" data-slot="city-field">
                City
                <select
                  name="city"
                  value={selectedCity}
                  onChange={(event) => setSelectedCity(event.target.value)}
                >
                  {CITIES.map((item) => (
                    <option key={item.slug} value={item.slug}>
                      {item.display}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="category-field" data-slot="category-field">
              Service desk
              {lockCategory ? (
                <>
                  <span className="locked-field">
                    {categoryInfo?.display ?? activeCategory}
                  </span>
                  <input type="hidden" name="category" value={activeCategory} />
                </>
              ) : (
                <select
                  name="category"
                  value={selectedCategory}
                  onChange={(event) =>
                    setSelectedCategory(event.target.value as CategorySlug | "")
                  }
                  required
                  data-slot="category-control"
                >
                  <option value="">Choose a service desk</option>
                  {CATEGORIES.map((item) => (
                    <option key={item.slug} value={item.slug}>
                      {item.display}
                    </option>
                  ))}
                </select>
              )}
            </label>
            <label className="site-url-field" data-slot="site-url-field">
              Site URL
              <input
                name="siteUrl"
                type="text"
                inputMode="url"
                placeholder="your-business.example"
                required
                autoComplete="url"
                spellCheck={false}
                data-slot="url-input"
                value={siteUrl}
                onChange={(event) => setSiteUrl(event.target.value)}
              />
            </label>
            {licenseNeeded ? (
              <label className="license-field" data-slot="license-field">
                Claimed license id
                <input
                  name="licenseId"
                  minLength={2}
                  maxLength={64}
                  required
                  autoComplete="off"
                  value={licenseId}
                  onChange={(event) => setLicenseId(event.target.value)}
                />
                <span className="field-hint">Stored as claimed, not verified.</span>
              </label>
            ) : null}
            <div className="bid-row" data-slot="claim-action">
              <button
                type="submit"
                className="outbid"
                aria-label={isNewListing ? "Claim rank" : "Outbid"}
                disabled={!canSubmit}
                data-submit-ready={canSubmit ? "true" : "false"}
                data-slot="claim-button"
              >
                {isNewListing ? "Claim rank" : "Outbid"}
              </button>
            </div>
          </div>
        </div>
      </form>
    </section>
  );
}
