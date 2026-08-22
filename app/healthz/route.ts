import { getDb } from "../../src/db";

/** GET /healthz — process + SQLite probe. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type HealthzOk = {
  ok: true;
};

export function GET(): Response {
  getDb().prepare("SELECT 1 AS ok").get();
  return Response.json({ ok: true } satisfies HealthzOk, { status: 200 });
}
