import twilio from "twilio";
import crypto from "node:crypto";

/**
 * Twilio Studio IVR — kicks off a Studio Flow execution that dials
 * the debtor, plays the flow's TTS prompts, gathers DTMF, and posts
 * step events back to /api/twilio/studio/webhook.
 *
 * The Studio Flow is authored in the Twilio console (visual builder).
 * We pass the debtor context as flow parameters so the flow's Say
 * widgets can template them ({{flow.data.partyName}} etc).
 */

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function client() {
  return twilio(
    requireEnv("TWILIO_ACCOUNT_SID"),
    requireEnv("TWILIO_AUTH_TOKEN"),
  );
}

export type StudioCallParams = {
  toNumber: string;
  /** Flow parameters available as {{flow.data.X}} inside Studio. */
  parameters: Record<string, string | number>;
};

export async function startStudioCall(
  args: StudioCallParams,
): Promise<{ executionSid: string; contactChannelAddress: string }> {
  const flowSid = requireEnv("TWILIO_STUDIO_FLOW_SID");
  const from = requireEnv("TWILIO_FROM_NUMBER");

  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(args.parameters)) {
    params[k] = String(v);
  }

  const exec = await client()
    .studio.v2.flows(flowSid)
    .executions.create({
      to: args.toNumber,
      from,
      parameters: params,
    });

  return {
    executionSid: exec.sid,
    contactChannelAddress: args.toNumber,
  };
}

/**
 * Twilio signs webhook requests with `X-Twilio-Signature`. Verify by
 * recomputing HMAC-SHA1 of `url + concatenated(sortedFormKeys+values)`
 * with the account auth token and comparing constant-time.
 *
 * For JSON webhooks (Studio sends JSON to Webhook widgets), Twilio
 * signs the JSON body as the "param" string instead. We support both.
 */
export function verifyTwilioSignature(
  url: string,
  body: Record<string, string> | string,
  signature: string | null,
): boolean {
  if (!signature) return false;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) return false;

  let payload: string;
  if (typeof body === "string") {
    payload = url + body;
  } else {
    const keys = Object.keys(body).sort();
    payload = url + keys.map((k) => k + body[k]).join("");
  }

  const expected = crypto
    .createHmac("sha1", token)
    .update(payload, "utf8")
    .digest("base64");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected),
    );
  } catch {
    return false;
  }
}
