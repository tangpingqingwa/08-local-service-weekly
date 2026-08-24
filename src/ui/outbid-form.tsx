"use client";

import { useMemo, useState } from "react";
import {
  CATEGORIES,
  categoryRequiresLicense,
  type Category,
  type CategorySlug,
} from "../categories";
import { CITIES, type City } from "../cities";
import { MAX_BID_USD, MIN_BID_USD } from "../constants";

type OutbidFormProps = {
  city?: string;
  category?: CategorySlug;
  lockCity?: boolean;
  lockCategory?: boolean;
  emptyPaper?: boolean;
};

function clampAmount(value: number): number {
  if (!Number.isFinite(value)) return MIN_BID_USD;
  return Math.min(MAX_BID_USD, Math.max(MIN_BID_USD, Math.trunc(value)));
}

export function OutbidForm({
  city,
  category,
  lockCity = false,
  lockCategory = false,
  emptyPaper = false,
}: OutbidFormProps) {
  const defaultCity = city ?? CITIES[0]?.slug ?? "london";
  const defaultCategory = category ?? CATEGORIES[0]?.slug ?? "movers";
  const [amount, setAmount] = useState(MIN_BID_USD);
  const [selectedCity, setSelectedCity] = useState(defaultCity);
  const [selectedCategory, setSelectedCategory] = useState(defaultCategory);

  const activeCategory = lockCategory ? defaultCategory : selectedCategory;
  const licenseNeeded = categoryRequiresLicense(activeCategory);
  const cityOptions: readonly City[] = CITIES;
  const categoryOptions: readonly Category[] = CATEGORIES;

  const licenseHint = useMemo(
    () => (licenseNeeded ? "Claimed license id (not verified)." : null),
    [licenseNeeded],
  );

  function bump(delta: number) {
    setAmount((current) => clampAmount(current + delta));
  }

  const identityFields = (
    <>
      <label>
        Business
        <input
          name="business"
          maxLength={80}
          required
          autoComplete="organization"
          placeholder="Business name"
        />
      </label>
      {lockCity ? (
        <input type="hidden" name="city" value={defaultCity} />
      ) : (
        <label>
          City
          <select
            name="city"
            value={selectedCity}
            onChange={(event) => setSelectedCity(event.target.value)}
          >
            {cityOptions.map((item) => (
              <option key={item.slug} value={item.slug}>
                {item.display}
              </option>
            ))}
          </select>
        </label>
      )}
      {lockCategory ? (
        <input type="hidden" name="category" value={defaultCategory} />
      ) : (
        <label>
          Category
          <select
            name="category"
            value={selectedCategory}
            onChange={(event) =>
              setSelectedCategory(event.target.value as CategorySlug)
            }
          >
            {categoryOptions.map((item) => (
              <option key={item.slug} value={item.slug}>
                {item.display}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        Site URL
        <input
          name="siteUrl"
          type="url"
          placeholder="https://"
          required
          autoComplete="url"
          spellCheck={false}
        />
      </label>
      {licenseNeeded ? (
        <label>
          License id
          <input
            name="licenseId"
            minLength={2}
            maxLength={64}
            required
            autoComplete="off"
          />
          <span className="field-hint">{licenseHint}</span>
        </label>
      ) : null}
    </>
  );

  const outbid = (
    <button type="submit" className="outbid">
      Outbid
    </button>
  );

  return (
    <section
      className={
        emptyPaper ? "claim empty-claim-first" : "claim later-claim"
      }
      id="claim"
      {...(emptyPaper
        ? { "data-empty-claim-first": "", "aria-label": "Claim #1" }
        : { "data-later-claim": "" })}
    >
      <form
        method="post"
        action="/api/checkout"
        data-bid-form=""
        data-city={lockCity ? defaultCity : selectedCity}
        data-category={activeCategory}
      >
        {emptyPaper ? null : (
          <p className="later-claim-label">Then Claim #1</p>
        )}
        <h2
          {...(emptyPaper
            ? { "data-empty-claim": "", "data-first-click": "claim" }
            : {})}
        >
          <span>Claim #1 for</span>
          <span className="amount-stepper">
            <button
              type="button"
              className="step"
              aria-label="Decrease bid by one dollar"
              onClick={() => bump(-1)}
            >
              −
            </button>
            <label className="amount-field">
              <span className="sr-only">Amount in dollars</span>
              $
              <input
                name="amount"
                inputMode="numeric"
                pattern="[0-9]*"
                value={amount}
                onChange={(event) => {
                  const next = Number(event.target.value.replace(/[^\d]/g, ""));
                  setAmount(clampAmount(next || MIN_BID_USD));
                }}
              />
            </label>
            <button
              type="button"
              className="step"
              aria-label="Increase bid by one dollar"
              onClick={() => bump(1)}
            >
              +
            </button>
          </span>
        </h2>
        <p className="claim-note">
          New spots start at ${MIN_BID_USD}. Paying less than #1 still lists at
          the rank that bid can take. Rank is the bid. Unpaid checkout stays off
          the board until Polar reports paid. An abandoned listing is not #1.
        </p>
        {emptyPaper ? (
          <>
            <div className="bid-row">{outbid}</div>
            <div
              className="listing-identity"
              data-listing-identity=""
              data-later-write=""
            >
              <p className="later-write-label">Then the listing name</p>
              <div className="fields want-ad-fields">{identityFields}</div>
            </div>
          </>
        ) : (
          <div className="fields want-ad-fields">
            {identityFields}
            <div className="bid-row">{outbid}</div>
          </div>
        )}
      </form>
    </section>
  );
}
