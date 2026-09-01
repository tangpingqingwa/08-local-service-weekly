import { getDb } from "../../src/db";
import { validateWaffoConfiguration } from "../../src/billing/waffo-session";

/** GET /healthz — selected Waffo configuration + SQLite readiness probe. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type HealthzOk = {
  ok: true;
};

type HealthzNotReady = {
  ok: false;
  error: "not_ready";
};

export function GET(): Response {
  try {
    validateWaffoConfiguration();
    getDb().prepare("SELECT 1 AS ok").get();
    return Response.json({ ok: true } satisfies HealthzOk, { status: 200 });
  } catch {
    // Configuration errors can contain secret names. Keep readiness responses
    // stable and non-secret while allowing the process to report not-ready.
    return Response.json(
      { ok: false, error: "not_ready" } satisfies HealthzNotReady,
      { status: 503 },
    );
  }
}
