import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";

import { FakePaymentPort, getPaymentPort, resetPaymentFixture, setPaymentPortForTests } from "../src/billing/fake";
import { PaymentError } from "../src/billing/port";
import { waffoMode } from "../src/billing/waffo-session";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const mutableEnv = process.env as Record<string, string | undefined>;

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

afterEach(() => {
  setPaymentPortForTests(undefined);
  resetPaymentFixture();
  delete mutableEnv.PAYMENT_MODE;
  delete mutableEnv.WAFFO_MODE;
  delete mutableEnv.POLAR_FIXTURE_ONLY;
});

test("live-smoke.sh remains executable, operator-only, and never invents a provider", () => {
  const scriptPath = join(ROOT, "scripts/live-smoke.sh");
  assert.equal(existsSync(scriptPath), true);
  assert.equal(statSync(scriptPath).mode & 0o111, 0o111);
  const script = read("scripts/live-smoke.sh");
  assert.match(script, /live-smoke refuses CI=true/);
  assert.match(script, /live-smoke must not run in GitHub Actions/);
  assert.match(script, /WAFFO_MODE|PAYMENT_MODE/);
  assert.match(script, /waffo|Waffo/);
  assert.match(script, /data-empty-lane/);
  assert.match(script, /Do not invent a provider|no invented provider/i);
});

test("live-smoke card parser accepts the classified-ad class token", () => {
  const html = '<article class="card classified-ad local-ad-slip" data-listing-id="lst_1" data-rank="1" data-provider-paid="" data-bid-usd="20" data-clicks="">Smoke Movers 1</article>';
  const cards = [...html.matchAll(/<article\b[^>]*\bclass="[^"]*\bcard\b[^"]*"[^>]*>[\s\S]*?<\/article>/g)];
  assert.equal(cards.length, 1);
  assert.match(cards[0]?.[0] ?? "", /data-rank="1"/);
  assert.match(cards[0]?.[0] ?? "", /data-provider-paid/);
  assert.match(cards[0]?.[0] ?? "", /data-bid-usd="20"/);
  assert.match(cards[0]?.[0] ?? "", /data-clicks/);
  assert.equal(read("scripts/live-smoke.sh").includes("/<article\\b"), true);
});

test("live-smoke proves the compiled file-backed runtime and mode-scoped Waffo gate", () => {
  const script = read("scripts/live-smoke.sh");
  assert.match(script, /exec npx --no-install next start/);
  assert.doesNotMatch(script, /exec npx --no-install next dev/);
  assert.match(script, /journal_mode/);
  assert.match(script, /durable SQLite restart/);
  assert.match(script, /WAFFO_WEBHOOK_TEST_PUBLIC_KEY/);
  assert.match(script, /WAFFO_WEBHOOK_PROD_PUBLIC_KEY/);
  assert.match(script, /WAFFO_PRIVATE_KEY_FILE/);
});

test("scripts/test.sh and CI stay offline and explicitly select fixture mode", () => {
  const testSh = read("scripts/test.sh");
  const ci = read(".github/workflows/ci.yml");
  assert.doesNotMatch(testSh, /^\s*(?:bash\s+)?(?:\.\/)?scripts\/live-smoke\.sh/m);
  assert.match(testSh, /PAYMENT_MODE=fixture/);
  assert.doesNotMatch(testSh, /(?:^|\s)(?:export\s+)?(?:WAFFO_MODE|PAYMENT_MODE)=waffo-(?:test|prod)/);
  assert.doesNotMatch(ci, /live-smoke|WAFFO_PRIVATE_KEY|WAFFO_LIVE/);
  assert.match(ci, /bash scripts\/test\.sh/);
});

test("provider truth table requires an explicit Waffo mode and ignores legacy provider debris", () => {
  assert.equal(waffoMode({ PAYMENT_MODE: "fixture" }), "fixture");
  assert.equal(waffoMode({ PAYMENT_MODE: "waffo-test" }), "waffo-test");
  assert.equal(waffoMode({ WAFFO_LIVE: "1" }), undefined);
  assert.equal(waffoMode({ PAYMENT_MODE: "waffo-test", POLAR_FIXTURE_ONLY: "1" }), "waffo-test");
  assert.equal(waffoMode({ POLAR_FIXTURE_ONLY: "1" }), undefined);

  mutableEnv.PAYMENT_MODE = "fixture";
  assert.ok(getPaymentPort() instanceof FakePaymentPort);
  delete mutableEnv.PAYMENT_MODE;
  assert.throws(
    () => getPaymentPort(),
    (error: unknown) => error instanceof PaymentError && error.code === "waffo_mode_required",
  );
});
