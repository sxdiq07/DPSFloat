import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyTwilioSignature } from "@/lib/twilio";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Twilio webhook receiver. Handles TWO signal types from Studio:
 *
 * 1. Studio Execution callbacks (point the Studio Flow's
 *    "Flow Webhook URL" or HTTP-Request widgets here). These carry
 *    ExecutionSid + StepName so we can tag DTMF responses to the
 *    right CallLog row.
 *
 * 2. Voice Call StatusCallback — configure on the "Connect Call"
 *    widget or via the Twilio number's voice settings. Includes
 *    CallStatus (initiated/ringing/in-progress/completed/no-answer/
 *    busy/failed/canceled) and CallDuration.
 *
 * Both arrive as application/x-www-form-urlencoded POSTs.
 */

type FormBody = Record<string, string>;

async function readForm(req: NextRequest): Promise<FormBody> {
  const ct = req.headers.get("content-type") ?? "";
  const out: FormBody = {};
  if (ct.includes("application/json")) {
    const j = await req.json();
    for (const [k, v] of Object.entries(j)) out[k] = String(v);
    return out;
  }
  const form = await req.formData();
  for (const [k, v] of form.entries()) out[k] = String(v);
  return out;
}

const CALL_STATUS_MAP: Record<string, string> = {
  initiated: "INITIATED",
  ringing: "RINGING",
  "in-progress": "IN_PROGRESS",
  answered: "IN_PROGRESS",
  completed: "COMPLETED",
  busy: "BUSY",
  "no-answer": "NO_ANSWER",
  failed: "FAILED",
  canceled: "CANCELLED",
};

export async function POST(req: NextRequest) {
  // Twilio signs webhooks — reject if signature fails when secret is set.
  const rawBody = await req.text();
  const sig = req.headers.get("x-twilio-signature");
  const host = req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const url = `${proto}://${host}${req.nextUrl.pathname}${req.nextUrl.search}`;

  // Parse after we've grabbed the raw body for signature check.
  const body: FormBody = {};
  if ((req.headers.get("content-type") ?? "").includes("application/json")) {
    try {
      const j = JSON.parse(rawBody);
      for (const [k, v] of Object.entries(j)) body[k] = String(v);
    } catch {
      return NextResponse.json({ error: "bad json" }, { status: 400 });
    }
  } else {
    const params = new URLSearchParams(rawBody);
    for (const [k, v] of params.entries()) body[k] = v;
  }

  if (process.env.TWILIO_AUTH_TOKEN) {
    const isJson = (req.headers.get("content-type") ?? "").includes("application/json");
    const ok = verifyTwilioSignature(url, isJson ? rawBody : body, sig);
    if (!ok) {
      console.warn("[twilio-webhook] invalid signature");
      return NextResponse.json({ error: "invalid signature" }, { status: 401 });
    }
  }

  // Drop the raw form into a used-only copy so we can also use readForm
  // stylistically if needed elsewhere.
  void readForm;

  // Find the CallLog this event is about. Studio provides ExecutionSid;
  // the voice StatusCallback provides CallSid — we may have learned it
  // from a prior event, but the ExecutionSid is the stable key.
  const executionSid = body.ExecutionSid || body.executionSid || null;
  const callSid = body.CallSid || body.callSid || null;

  let log = null as { id: string } | null;
  if (executionSid) {
    log = await prisma.callLog.findUnique({
      where: { executionSid },
      select: { id: true },
    });
  }
  if (!log && callSid) {
    log = await prisma.callLog.findFirst({
      where: { callSid },
      select: { id: true },
    });
  }
  if (!log) {
    // Not ours (or yet to be upserted). Ack with 200 so Twilio doesn't
    // retry — we don't want to block unrelated flows.
    return NextResponse.json({ ok: true, skipped: "unknown_call" });
  }

  // Translate the event.
  const data: {
    status?:
      | "INITIATED"
      | "RINGING"
      | "IN_PROGRESS"
      | "COMPLETED"
      | "BUSY"
      | "NO_ANSWER"
      | "FAILED"
      | "CANCELLED";
    callSid?: string;
    dtmfResponse?: string;
    durationSec?: number;
    answeredAt?: Date;
    endedAt?: Date;
    error?: string;
  } = {};

  if (body.CallStatus) {
    const mapped = CALL_STATUS_MAP[body.CallStatus.toLowerCase()];
    if (mapped)
      data.status =
        mapped as NonNullable<typeof data.status>;
    if (body.CallStatus === "in-progress" || body.CallStatus === "answered") {
      data.answeredAt = new Date();
    }
    if (
      ["completed", "busy", "no-answer", "failed", "canceled"].includes(
        body.CallStatus,
      )
    ) {
      data.endedAt = new Date();
    }
  }

  if (callSid && !data.callSid) data.callSid = callSid;
  if (body.CallDuration) {
    const d = Number(body.CallDuration);
    if (Number.isFinite(d)) data.durationSec = d;
  }

  // Studio Widget → HTTP-Request: recommended convention is to pass
  // the pressed digit through the webhook's payload as `Digits` or
  // `dtmf`. Whatever name the flow uses, we accept a few aliases.
  const pressed =
    body.Digits ||
    body.dtmf ||
    body.digit ||
    body.Key ||
    null;
  if (pressed) data.dtmfResponse = pressed.toString().slice(0, 10);

  if (body.ErrorCode || body.ErrorMessage) {
    data.error = `${body.ErrorCode ?? ""} ${body.ErrorMessage ?? ""}`.trim();
  }

  if (Object.keys(data).length > 0) {
    await prisma.callLog.update({ where: { id: log.id }, data });
  }

  return NextResponse.json({ ok: true, callId: log.id });
}
