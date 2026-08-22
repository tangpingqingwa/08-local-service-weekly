import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { openDatabase } from "../src/db";
import {
  FakePolarPort,
  getPolarPort,
  resetPolarFixture,
} from "../src/polar/fake";
import { LivePolarPort } from "../src/polar/live";
import { isPolarLive, PolarError, polarFixtureOnly } from "../src/polar/port";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

test("live-smoke.sh is executable and operator-only", () => {
  const scriptPath = join(ROOT, "scripts/live-smoke.sh");
  assert.equal(existsSync(scriptPath), true);
  const mode = statSync(scriptPath).mode;
  assert.equal(mode & 0o111, 0o111, "scripts/live-smoke.sh must be executable");

  const script = read("scripts/live-smoke.sh");
  assert.match(script, /BLOCKED-SECRET: POLAR_ACCESS_TOKEN/);
  assert.match(script, /POLAR_LIVE/);
  assert.match(script, /POLAR_FIXTURE_ONLY/);
  assert.match(script, /live-smoke refuses CI=true/);
  assert.match(script, /live-smoke must not run in GitHub Actions/);
  assert.match(script, /\/healthz/);
  assert.match(script, /\/c\/london\/movers/);
  assert.match(script, /\/about/);
  assert.match(script, /\/rules/);
  assert.match(script, /\/api\/checkout/);
  assert.match(script, /\/api\/raise/);
  assert.match(script, /\/go\//);
  assert.match(script, /\/api\/takedown/);
  assert.match(script, /data-empty-lane/);
  assert.match(script, /no invented provider|Do not invent a provider/i);
  assert.doesNotMatch(script, /invented paid #1/);
});

test("docs/live-smoke.md records verdict labels and is not a paid-rank invention", () => {
  const docs = read("docs/live-smoke.md");
  assert.match(docs, /PASS/);
  assert.match(docs, /PASS-ERROR/);
  assert.match(docs, /BLOCKED-SECRET/);
  assert.match(docs, /FAIL/);
  assert.match(docs, /scripts\/live-smoke\.sh/);
  assert.match(
    docs,
    /not\*\* called from `scripts\/test\.sh`|not called from `scripts\/test\.sh`/i,
  );
  assert.match(docs, /POLAR_ACCESS_TOKEN/);
  assert.match(docs, /London/);
  assert.doesNotMatch(docs, /invented paid #1|seeded fake #1|placeholder provider/);
});

test("scripts/test.sh and CI stay offline and do not invoke live-smoke", () => {
  const testSh = read("scripts/test.sh");
  const ci = read(".github/workflows/ci.yml");

  assert.doesNotMatch(testSh, /^\s*(bash )?(\.\/)?scripts\/live-smoke\.sh/m);
  assert.doesNotMatch(testSh, /^(export )?POLAR_LIVE=1/m);
  assert.match(testSh, /must not invoke live-smoke/);
  assert.match(testSh, /unset POLAR_LIVE POLAR_ACCESS_TOKEN POLAR_WEBHOOK_SECRET/);
  assert.match(testSh, /POLAR_FIXTURE_ONLY=1/);

  assert.doesNotMatch(ci, /live-smoke/);
  assert.doesNotMatch(ci, /POLAR_LIVE/);
  assert.doesNotMatch(ci, /POLAR_ACCESS_TOKEN/);
  assert.match(ci, /bash scripts\/test\.sh/);
});

test("POLAR_LIVE=1 + secrets selects Polar; POLAR_FIXTURE_ONLY=1 wins", () => {
  assert.equal(isPolarLive({}), false);
  assert.equal(isPolarLive({ POLAR_LIVE: "0" }), false);
  assert.equal(isPolarLive({ POLAR_LIVE: "1" }), true);
  assert.equal(
    isPolarLive({ POLAR_LIVE: "1", POLAR_FIXTURE_ONLY: "1" }),
    false,
  );
  assert.equal(polarFixtureOnly({ POLAR_FIXTURE_ONLY: "1" }), true);

  const previousLive = process.env.POLAR_LIVE;
  const previousFixture = process.env.POLAR_FIXTURE_ONLY;
  const previousToken = process.env.POLAR_ACCESS_TOKEN;
  const db = openDatabase(":memory:");
  after(() => {
    db.close();
    resetPolarFixture();
  });

  process.env.POLAR_LIVE = "1";
  process.env.POLAR_FIXTURE_ONLY = "1";
  delete process.env.POLAR_ACCESS_TOKEN;
  try {
    assert.equal(getPolarPort(db) instanceof FakePolarPort, true);
    assert.throws(
      () => new LivePolarPort({ db, env: { POLAR_LIVE: "1", POLAR_FIXTURE_ONLY: "1" } }),
      (err: unknown) => {
        assert.ok(err instanceof PolarError);
        assert.equal(err.code, "polar_not_live");
        return true;
      },
    );
  } finally {
    if (previousLive === undefined) delete process.env.POLAR_LIVE;
    else process.env.POLAR_LIVE = previousLive;
    if (previousFixture === undefined) delete process.env.POLAR_FIXTURE_ONLY;
    else process.env.POLAR_FIXTURE_ONLY = previousFixture;
    if (previousToken === undefined) delete process.env.POLAR_ACCESS_TOKEN;
    else process.env.POLAR_ACCESS_TOKEN = previousToken;
  }
});

test("missing POLAR_ACCESS_TOKEN is BLOCKED-SECRET; constructor does not fetch", () => {
  const db = openDatabase(":memory:");
  after(() => db.close());

  assert.throws(
    () =>
      new LivePolarPort({
        db,
        env: { POLAR_LIVE: "1" },
      }),
    /BLOCKED-SECRET: POLAR_ACCESS_TOKEN/,
  );
  assert.throws(
    () => new LivePolarPort({ db, env: {} }),
    (err: unknown) => {
      assert.ok(err instanceof PolarError);
      assert.equal(err.code, "polar_not_live");
      return true;
    },
  );

  let fetched = false;
  const stubFetch = (async () => {
    fetched = true;
    throw new Error("live Polar must not fetch in tests");
  }) as typeof fetch;
  const live = new LivePolarPort({
    db,
    env: { POLAR_LIVE: "1", POLAR_ACCESS_TOKEN: "polar_tok_test" },
    fetch: stubFetch,
  });
  assert.equal(live.kind, "live");
  assert.equal(fetched, false);

  const previousLive = process.env.POLAR_LIVE;
  const previousFixture = process.env.POLAR_FIXTURE_ONLY;
  const previousToken = process.env.POLAR_ACCESS_TOKEN;
  process.env.POLAR_LIVE = "1";
  delete process.env.POLAR_FIXTURE_ONLY;
  process.env.POLAR_ACCESS_TOKEN = "polar_tok_test";
  try {
    const port = getPolarPort(db);
    assert.ok(port instanceof LivePolarPort);
    assert.equal(port.kind, "live");
  } finally {
    if (previousLive === undefined) delete process.env.POLAR_LIVE;
    else process.env.POLAR_LIVE = previousLive;
    if (previousFixture === undefined) delete process.env.POLAR_FIXTURE_ONLY;
    else process.env.POLAR_FIXTURE_ONLY = previousFixture;
    if (previousToken === undefined) delete process.env.POLAR_ACCESS_TOKEN;
    else process.env.POLAR_ACCESS_TOKEN = previousToken;
  }
});
