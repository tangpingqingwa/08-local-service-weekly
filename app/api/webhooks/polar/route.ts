export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Obsolete compatibility path. Waffo production webhooks must target
 * /api/webhooks/waffo; this endpoint is deliberately non-authoritative.
 */
export async function POST(_request: Request): Promise<Response> {
  return Response.json(
    { error: "webhook_route_moved", endpoint: "/api/webhooks/waffo" },
    { status: 410 },
  );
}
