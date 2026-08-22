import { NextResponse } from "next/server";

export const HEALTHZ_PATH = "/healthz" as const;

export type HealthzOk = {
  ok: true;
};

export function GET(): NextResponse<HealthzOk> {
  return NextResponse.json({ ok: true });
}
