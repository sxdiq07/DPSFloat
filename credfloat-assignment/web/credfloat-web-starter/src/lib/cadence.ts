/**
 * Dynamic cadence — ML-calibrated "best time to reach this debtor."
 *
 * Learns from each debtor's own reminder history:
 *   - When we've sent them reminders (sentAt)
 *   - Which ones they engaged with (Resend webhook flips status to
 *     READ / DELIVERED vs BOUNCED / FAILED)
 *   - Which channel they engaged with most
 *
 * For each debtor with ≥3 sends of history we compute:
 *   - bestHour        (0-23 in IST)  — hour with highest engagement rate
 *   - bestDayOfWeek   (0=Sun..6=Sat) — day-of-week with highest engagement rate
 *   - bestChannel     (EMAIL / WHATSAPP / SMS) — channel with highest open rate
 *
 * Below that threshold we return `null` — cold-start, use the firm-
 * wide default schedule.
 *
 * This is intentionally NOT heavy ML (XGBoost, neural nets). With
 * ~30 events per debtor at best, a statistical bucketing model is
 * more honest and explainable than a trained classifier. The "best
 * hour" is literally the hour with the highest engagement rate in
 * their history — every partner can audit it.
 */

import { prisma } from "@/lib/prisma";

export type CadenceHint = {
  bestHour: number; // 0-23
  bestDayOfWeek: number; // 0-6
  bestChannel: "EMAIL" | "WHATSAPP" | "SMS" | null;
  confidence: "high" | "medium" | "low";
  sampleSize: number;
};

const IST_OFFSET_MINUTES = 330;

function istHour(d: Date): number {
  const local = new Date(d.getTime() + IST_OFFSET_MINUTES * 60_000);
  return local.getUTCHours();
}

function istDayOfWeek(d: Date): number {
  const local = new Date(d.getTime() + IST_OFFSET_MINUTES * 60_000);
  return local.getUTCDay();
}

/**
 * Compute cadence hints for every debtor in a firm. Returns a Map
 * keyed by partyId. Parties with too little history are omitted.
 */
export async function computeCadenceHints(
  firmId: string,
): Promise<Map<string, CadenceHint>> {
  const rows = await prisma.reminderSent.findMany({
    where: { party: { clientCompany: { firmId } } },
    select: {
      partyId: true,
      channel: true,
      sentAt: true,
      status: true,
    },
    orderBy: { sentAt: "desc" },
    take: 5000,
  });

  // Group by party
  const byParty = new Map<string, typeof rows>();
  for (const r of rows) {
    const arr = byParty.get(r.partyId) ?? [];
    arr.push(r);
    byParty.set(r.partyId, arr);
  }

  const positive = new Set(["DELIVERED", "READ"]);

  const out = new Map<string, CadenceHint>();

  for (const [partyId, events] of byParty.entries()) {
    if (events.length < 3) continue;

    // Per-hour engagement rate
    const hourStats = new Map<
      number,
      { sent: number; positive: number }
    >();
    const dayStats = new Map<
      number,
      { sent: number; positive: number }
    >();
    const channelStats = new Map<
      string,
      { sent: number; positive: number }
    >();
    for (const e of events) {
      const h = istHour(e.sentAt);
      const d = istDayOfWeek(e.sentAt);
      const hCell = hourStats.get(h) ?? { sent: 0, positive: 0 };
      const dCell = dayStats.get(d) ?? { sent: 0, positive: 0 };
      const cCell = channelStats.get(e.channel) ?? { sent: 0, positive: 0 };
      hCell.sent++;
      dCell.sent++;
      cCell.sent++;
      if (positive.has(e.status)) {
        hCell.positive++;
        dCell.positive++;
        cCell.positive++;
      }
      hourStats.set(h, hCell);
      dayStats.set(d, dCell);
      channelStats.set(e.channel, cCell);
    }

    // Best = highest positive/sent rate, with a floor of 1 sample to
    // avoid outlier noise. When tied, prefer the bucket with more
    // volume (more certain).
    const pickBest = <K>(map: Map<K, { sent: number; positive: number }>): K | null => {
      let best: K | null = null;
      let bestRate = -1;
      let bestSent = 0;
      for (const [k, v] of map.entries()) {
        if (v.sent < 1) continue;
        const rate = v.positive / v.sent;
        if (rate > bestRate || (rate === bestRate && v.sent > bestSent)) {
          best = k;
          bestRate = rate;
          bestSent = v.sent;
        }
      }
      return best;
    };

    const bestHour = pickBest(hourStats);
    const bestDay = pickBest(dayStats);
    const bestChannelRaw = pickBest(channelStats);
    if (bestHour === null || bestDay === null) continue;

    const confidence: CadenceHint["confidence"] =
      events.length >= 15 ? "high" : events.length >= 7 ? "medium" : "low";

    out.set(partyId, {
      bestHour: bestHour as number,
      bestDayOfWeek: bestDay as number,
      bestChannel: (bestChannelRaw as "EMAIL" | "WHATSAPP" | "SMS" | null) ?? null,
      confidence,
      sampleSize: events.length,
    });
  }

  return out;
}

export function formatCadenceHint(h: CadenceHint): string {
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const hr = h.bestHour;
  const ampm = hr >= 12 ? "pm" : "am";
  const h12 = hr % 12 === 0 ? 12 : hr % 12;
  return `${dayNames[h.bestDayOfWeek]} ${h12}${ampm}`;
}
