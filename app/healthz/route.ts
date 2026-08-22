import { getDb } from "../../src/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const HEALTHZ_PATH = "/healthz" as const;

export type HealthzOk = {
  ok: true;
};

export function GET(): Response {
  getDb().prepare("SELECT 1 AS ok").get();
  return Response.json({ ok: true } satisfies HealthzOk, { status: 200 });
}
