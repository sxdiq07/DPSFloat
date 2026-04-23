"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Check, X, Sparkles, Calendar } from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { addPromise, resolvePromise } from "../_actions/promises";

type Party = { id: string; name: string };

export type PromiseRow = {
  id: string;
  partyName: string;
  amount: number;
  promisedBy: string;
  status: "OPEN" | "KEPT" | "BROKEN";
  notes: string | null;
  recordedAt: string;
  recorderName: string;
  amountFormatted: string;
};

function inr(n: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

export function PromisesPanel({
  parties,
  promises,
}: {
  parties: Party[];
  promises: PromiseRow[];
}) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [partyId, setPartyId] = useState(parties[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [dateStr, setDateStr] = useState(
    new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10),
  );
  const [notes, setNotes] = useState("");
  const [pending, startPending] = useTransition();

  const onAdd = () => {
    const amt = parseFloat(amount);
    if (!partyId) return toast.error("Pick a debtor");
    if (Number.isNaN(amt) || amt <= 0) return toast.error("Amount must be > 0");
    startPending(async () => {
      const res = await addPromise({
        partyId,
        amount: amt,
        promisedBy: new Date(dateStr).toISOString(),
        notes: notes || null,
      });
      if (res.ok) {
        toast.success("Promise recorded");
        setAmount("");
        setNotes("");
        setShowForm(false);
        router.refresh();
      } else toast.error(res.error);
    });
  };

  const onResolve = (id: string, status: "KEPT" | "BROKEN") => {
    startPending(async () => {
      const res = await resolvePromise(id, status);
      if (res.ok) {
        toast.success(status === "KEPT" ? "Marked kept" : "Marked broken");
        router.refresh();
      } else toast.error(res.error);
    });
  };

  return (
    <section className="card-apple overflow-hidden">
      <div className="flex items-end justify-between gap-4 px-8 pt-7 pb-5">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">
            Commitments
          </p>
          <h2 className="mt-2 text-[22px] font-semibold tracking-tight text-ink">
            Promises to pay
          </h2>
          <p className="mt-1 text-[14px] text-ink-3">
            Track what each debtor committed and whether they followed through.
            Feeds each party&apos;s reliability score.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="btn-apple h-9 gap-1.5 px-4"
        >
          <Plus className="h-3.5 w-3.5" />
          {showForm ? "Cancel" : "Record"}
        </button>
      </div>

      {showForm && parties.length > 0 && (
        <div className="border-t border-subtle bg-[var(--color-surface-2)]/40 px-8 py-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <div className="space-y-1.5 md:col-span-2">
              <label className="text-[12px] text-ink-2">Debtor</label>
              <select
                value={partyId}
                onChange={(e) => setPartyId(e.target.value)}
                className="h-10 w-full rounded-xl border border-[var(--color-border-hair)] bg-[var(--color-surface-3)] px-3.5 text-[14px] outline-none focus:border-[var(--color-accent-blue)] focus:ring-4 focus:ring-[rgba(0,113,227,0.12)]"
              >
                {parties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-[12px] text-ink-2">Amount (₹)</label>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="50000"
                className="h-10 w-full rounded-xl border border-[var(--color-border-hair)] bg-[var(--color-surface-3)] px-3.5 text-[14px] outline-none focus:border-[var(--color-accent-blue)] focus:ring-4 focus:ring-[rgba(0,113,227,0.12)]"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[12px] text-ink-2">Expected by</label>
              <input
                type="date"
                value={dateStr}
                onChange={(e) => setDateStr(e.target.value)}
                className="h-10 w-full rounded-xl border border-[var(--color-border-hair)] bg-[var(--color-surface-3)] px-3.5 text-[14px] outline-none focus:border-[var(--color-accent-blue)] focus:ring-4 focus:ring-[rgba(0,113,227,0.12)]"
              />
            </div>
            <div className="space-y-1.5 md:col-span-4">
              <label className="text-[12px] text-ink-2">
                Context (optional)
              </label>
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="E.g. 'Will pay once GST return filed'"
                className="h-10 w-full rounded-xl border border-[var(--color-border-hair)] bg-[var(--color-surface-3)] px-3.5 text-[14px] outline-none focus:border-[var(--color-accent-blue)] focus:ring-4 focus:ring-[rgba(0,113,227,0.12)]"
              />
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={onAdd}
              disabled={pending}
              className="btn-apple h-9 px-5 disabled:opacity-50"
            >
              {pending ? "Saving…" : "Save promise"}
            </button>
          </div>
        </div>
      )}

      {promises.length === 0 ? (
        <div className="border-t border-subtle px-8 py-16 text-center">
          <p className="text-[15px] font-medium text-ink">
            No promises recorded yet
          </p>
          <p className="mt-1 text-[13px] text-ink-3">
            The moment a debtor says &quot;I&apos;ll pay by Friday,&quot; log it
            here — reliability over time becomes a score.
          </p>
        </div>
      ) : (
        <div className="border-t border-subtle">
          {promises.map((p, i) => {
            const isPast = new Date(p.promisedBy).getTime() < Date.now();
            return (
              <div
                key={p.id}
                className={`grid grid-cols-[auto_1fr_auto] items-center gap-5 px-8 py-4 ${i > 0 ? "border-t border-subtle" : ""}`}
              >
                <div
                  className="flex h-10 w-10 items-center justify-center rounded-lg text-[#f5f5f4]"
                  style={{
                    background:
                      p.status === "KEPT"
                        ? "#1f7a4a"
                        : p.status === "BROKEN"
                          ? "#b91c1c"
                          : "#92400e",
                  }}
                  aria-hidden
                >
                  <Sparkles className="h-3.5 w-3.5" strokeWidth={1.5} />
                </div>

                <div className="min-w-0">
                  <div className="flex items-baseline gap-2">
                    <div className="text-[14.5px] font-medium text-ink">
                      {p.partyName}
                    </div>
                    <StatusPill status={p.status} />
                  </div>
                  <div className="tabular mt-0.5 text-[13px] text-ink-2">
                    {p.amountFormatted}
                    <span className="mx-1.5 text-ink-3">·</span>
                    <span className="inline-flex items-center gap-1 text-ink-3">
                      <Calendar className="h-3 w-3" />
                      {format(new Date(p.promisedBy), "dd MMM yyyy")}
                      {p.status === "OPEN" &&
                        (isPast ? (
                          <span className="text-[#c6373a]">
                            ({formatDistanceToNow(new Date(p.promisedBy))} ago)
                          </span>
                        ) : (
                          <span className="text-ink-3">
                            (in {formatDistanceToNow(new Date(p.promisedBy))})
                          </span>
                        ))}
                    </span>
                  </div>
                  {p.notes && (
                    <div className="mt-1 text-[12.5px] italic text-ink-3">
                      “{p.notes}”
                    </div>
                  )}
                  <div className="mt-1 text-[11px] text-ink-3">
                    Recorded {formatDistanceToNow(new Date(p.recordedAt), { addSuffix: true })} by {p.recorderName}
                  </div>
                </div>

                {p.status === "OPEN" && (
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => onResolve(p.id, "KEPT")}
                      disabled={pending}
                      className="inline-flex h-8 items-center gap-1 rounded-full bg-[rgba(48,209,88,0.12)] px-3 text-[12.5px] font-medium text-[#1f7a4a] transition-all hover:bg-[rgba(48,209,88,0.2)]"
                    >
                      <Check className="h-3.5 w-3.5" />
                      Kept
                    </button>
                    <button
                      type="button"
                      onClick={() => onResolve(p.id, "BROKEN")}
                      disabled={pending}
                      className="inline-flex h-8 items-center gap-1 rounded-full bg-[rgba(255,69,58,0.10)] px-3 text-[12.5px] font-medium text-[#c6373a] transition-all hover:bg-[rgba(255,69,58,0.18)]"
                    >
                      <X className="h-3.5 w-3.5" />
                      Broken
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function StatusPill({ status }: { status: "OPEN" | "KEPT" | "BROKEN" }) {
  const styles = {
    OPEN: { bg: "rgba(255,159,10,0.14)", color: "#9c5700" },
    KEPT: { bg: "rgba(48,209,88,0.14)", color: "#1f7a4a" },
    BROKEN: { bg: "rgba(255,69,58,0.12)", color: "#c6373a" },
  } as const;
  const s = styles[status];
  return (
    <span className="pill" style={{ background: s.bg, color: s.color }}>
      {status.toLowerCase()}
    </span>
  );
}
