import { verifyWebhook } from "@waffo/pancake-ts";
import { getDb } from "../../../../src/db";
import { getPaymentPort } from "../../../../src/billing/fake";
import { processWaffoWebhookEvent } from "../../../../src/billing/live";
import { PaymentError } from "../../../../src/billing/port";
import {
  requireWaffoMode,
  waffoEnvironment,
  waffoWebhookPublicKey,
} from "../../../../src/billing/waffo-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Canonical Waffo webhook boundary. The verified event.id is the delivery
 * identity; the compatibility webhook-id header is accepted only when it
 * agrees with the signed body and can never replace it.
 */
export async function POST(request: Request): Promise<Response> {
  let port;
  try {
    // A test override carries its own captured environment. Production still
    // validates the explicit Waffo mode/config before this handler proceeds.
    port = getPaymentPort();
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("BLOCKED-SECRET:")) {
      return Response.json({ error: error.message }, { status: 503 });
    }
    if (error instanceof PaymentError) {
      return Response.json({ error: error.code }, { status: error.httpStatus });
    }
    return Response.json({ error: "waffo_mode_required" }, { status: 503 });
  }
  if (port.kind !== "live") {
    return Response.json({ error: "waffo_not_live" }, { status: 503 });
  }

  const rawBody = await request.text();
  let event: unknown;
  try {
    const signature = request.headers.get("x-waffo-signature");
    const verifier = (port as typeof port & {
      verifyWebhook?: (body: string, sig: string | null | undefined) => unknown;
    }).verifyWebhook;
    if (verifier) {
      event = verifier.call(port, rawBody, signature);
    } else {
      const mode = requireWaffoMode(process.env);
      const publicKey = waffoWebhookPublicKey(process.env, mode);
      // Waffo requires the exact unparsed request body. The SDK performs the
      // RSA-SHA256/timestamp checks with the explicit per-environment key.
      event = verifyWebhook(rawBody, signature, {
        environment: waffoEnvironment(mode),
        publicKey,
      });
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("BLOCKED-SECRET:")) {
      return Response.json({ error: error.message }, { status: 503 });
    }
    return Response.json({ error: "invalid_webhook_signature" }, { status: 403 });
  }

  const eventRecord = event as { id?: unknown };
  const signedDeliveryId = typeof eventRecord.id === "string" ? eventRecord.id.trim() : "";
  const compatibilityHeader = request.headers.get("webhook-id")?.trim() ?? "";
  if (!signedDeliveryId) {
    return Response.json({ error: "webhook_id_missing" }, { status: 400 });
  }
  if (compatibilityHeader && compatibilityHeader !== signedDeliveryId) {
    return Response.json({ error: "webhook_id_mismatch" }, { status: 400 });
  }

  try {
    const runtimeEnv = (port as typeof port & {
      environment?: () => Record<string, string | undefined>;
    }).environment?.() ?? process.env;
    const result = processWaffoWebhookEvent(
      event as Record<string, unknown>,
      port.database?.() ?? getDb(),
      signedDeliveryId,
      runtimeEnv,
      rawBody,
    );
    const status =
      !result.durable
        ? 503
        : result.status === "rejected"
          ? 409
          : result.status === "needs_reconciliation"
            ? 202
            : 200;
    return Response.json(result, { status });
  } catch (error) {
    if (error instanceof PaymentError) {
      return Response.json({ error: error.code }, { status: error.httpStatus });
    }
    return Response.json({ error: "webhook_processing_failed" }, { status: 500 });
  }
}
