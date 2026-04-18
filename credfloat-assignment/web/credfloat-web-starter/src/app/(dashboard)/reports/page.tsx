import { BarChart3, TrendingUp, Users } from "lucide-react";

export default function ReportsPage() {
  return (
    <div className="space-y-10">
      <section>
        <p className="text-[13px] font-medium uppercase tracking-[0.14em] text-ink-3">
          Insights
        </p>
        <h1 className="mt-2 text-display font-semibold text-ink">Reports</h1>
        <p className="mt-2 text-[15px] text-ink-3">
          Collection velocity, ageing trends, and per-client performance.
        </p>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <PreviewCard
          icon={<TrendingUp className="h-5 w-5" />}
          title="Collections trend"
          body="Monthly receipts across all managed clients, last 12 months."
          gradient="linear-gradient(135deg, hsl(142 70% 45%), hsl(168 75% 42%))"
        />
        <PreviewCard
          icon={<BarChart3 className="h-5 w-5" />}
          title="Ageing snapshot"
          body="Weekly percentage of receivables in each bucket."
          gradient="linear-gradient(135deg, hsl(211 100% 50%), hsl(260 75% 55%))"
        />
        <PreviewCard
          icon={<Users className="h-5 w-5" />}
          title="Per-client leaderboard"
          body="Days-to-collect, reminder response rate, recovered amounts."
          gradient="linear-gradient(135deg, hsl(22 100% 52%), hsl(14 95% 55%))"
        />
      </section>

      <section className="card-apple p-12 text-center">
        <div className="mx-auto max-w-md space-y-3">
          <p className="text-[17px] font-medium text-ink">
            Reports unlock once bill-wise invoice sync lands.
          </p>
          <p className="text-[14px] text-ink-3">
            The schema, sync pipeline, and ageing logic are already in place.
            Phase 2 adds Tally XML HTTP for invoice-level data; charts land
            automatically once receipts and ageing snapshots start accumulating.
          </p>
        </div>
      </section>
    </div>
  );
}

function PreviewCard({
  icon,
  title,
  body,
  gradient,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  gradient: string;
}) {
  return (
    <div className="card-apple p-6">
      <div
        className="mb-5 inline-flex h-10 w-10 items-center justify-center rounded-xl text-white shadow-apple-sm"
        style={{ background: gradient }}
      >
        {icon}
      </div>
      <h3 className="text-[16px] font-semibold text-ink">{title}</h3>
      <p className="mt-1.5 text-[13px] leading-relaxed text-ink-3">{body}</p>
    </div>
  );
}
