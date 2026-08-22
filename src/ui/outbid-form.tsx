"use client";

import { useMemo, useState, type FormEvent } from "react";
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
}: OutbidFormProps) {
  const defaultCity = city ?? CITIES[0]?.slug ?? "london";
  const defaultCategory = category ?? CATEGORIES[0]?.slug ?? "movers";
  const [amount, setAmount] = useState(MIN_BID_USD);
  const [selectedCity, setSelectedCity] = useState(defaultCity);
  const [selectedCategory, setSelectedCategory] = useState(defaultCategory);
  const [notice, setNotice] = useState<string | null>(null);

  const activeCategory = lockCategory ? defaultCategory : selectedCategory;
  const licenseNeeded = categoryRequiresLicense(activeCategory);
  const cityOptions: readonly City[] = CITIES;
  const categoryOptions: readonly Category[] = CATEGORIES;

  const licenseHint = useMemo(
    () =>
      licenseNeeded
        ? "Claimed license id (not verified)."
        : null,
    [licenseNeeded],
  );

  function bump(delta: number) {
    setAmount((current) => clampAmount(current + delta));
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice("Checkout is not live. No charge and no rank claimed.");
  }

  return (
    <section className="claim" id="claim">
      <form
        onSubmit={onSubmit}
        data-bid-form=""
        data-city={lockCity ? defaultCity : selectedCity}
        data-category={activeCategory}
      >
        <h2>
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
          the rank that bid can take. Rank is the bid.
        </p>
        <div className="fields">
          <label>
            Business
            <input
              name="business"
              maxLength={80}
              required
              autoComplete="organization"
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
        </div>
        <div className="bid-row">
          <button type="submit" className="outbid">
            Outbid
          </button>
        </div>
        {notice ? (
          <p className="stub-note" data-checkout-stub="">
            {notice}
          </p>
        ) : null}
      </form>
    </section>
  );
}
