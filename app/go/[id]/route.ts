import { NextResponse } from "next/server";
import { ClickError, incrementPublicClick } from "../../../src/clicks";
import { getDb, type AppDb } from "../../../src/db";
import { getPolarPort } from "../../../src/polar/fake";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GoContext = {
  params: Promise<{ id: string }>;
};

/** GET /go/:id — increment public clicks, 302 to the cleaned site URL. */
export async function GET(
  _request: Request,
  context: GoContext,
): Promise<Response> {
  const params = await Promise.resolve(context.params);
  try {
    const hop = incrementPublicClick(listingStore(), params.id ?? "");
    const response = NextResponse.redirect(hop.url, 302);
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch (error) {
    if (error instanceof ClickError) {
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
