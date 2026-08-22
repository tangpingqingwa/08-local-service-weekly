import { getDb, type AppDb } from "../../../src/db";
import { getPolarPort } from "../../../src/polar/fake";
import { PolarError } from "../../../src/polar/port";
import {
  operatorHideListing,
  parseTakedownReason,
  TakedownError,
} from "../../../src/takedown";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Operator hide. Shared secret; bid is not refunded. */
export async function POST(request: Request): Promise<Response> {
  try {
    const input = await readInput(request);
    const listingId = readRequired(input.listingId ?? input.id, "listingId");
    const reason = parseTakedownReason(input.reason);
    const complaint =
      typeof input.complaint === "string" ? input.complaint : null;
    const secret = operatorSecret(request, input);
    const listing = operatorHideListing(
      {
        listingId,
        reason,
        complaint,
        secret,
      },
      listingStore(),
    );
    return Response.json(
      {
        id: listing.id,
        hidden: listing.hidden,
        hiddenReason: listing.hiddenReason,
      },
      { status: 200 },
    );
  } catch (error) {
    if (error instanceof TakedownError || error instanceof PolarError) {
      return Response.json({ error: error.code }, { status: error.httpStatus });
    }
    throw error;
  }
}

function listingStore(): AppDb {
  const port = getPolarPort();
  if (typeof port.database === "function") {
    return port.database();
  }
  return getDb();
}

function operatorSecret(
  request: Request,
  input: Record<string, unknown>,
): string | null {
  const header =
    request.headers.get("x-operator-secret") ??
    request.headers.get("authorization");
  if (header) {
    return header.replace(/^Bearer\s+/i, "").trim();
  }
  return typeof input.secret === "string" ? input.secret : null;
}

function readRequired(raw: unknown, field: string): string {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new TakedownError("invalid_takedown", 400, `Missing ${field}`);
  }
  return raw.trim();
}

async function readInput(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new TakedownError("invalid_takedown", 400);
    }
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw new TakedownError("invalid_takedown", 400);
    }
    return body as Record<string, unknown>;
  }
  const form = await request.formData();
  const input: Record<string, unknown> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") {
      input[key] = value;
    }
  }
  return input;
}
