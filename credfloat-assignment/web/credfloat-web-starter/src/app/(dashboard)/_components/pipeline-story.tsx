import { Database, Cable, CloudCog, MessageSquare, UserCircle2 } from "lucide-react";

type Node = {
  key: string;
  icon: React.ReactNode;
  title: string;
  detail: string;
  gradient: string;
};

export function PipelineStory({
  totalOutstandingCompact,
  partyCount,
  reachableCount,
  clientCount,
  remindersToday,
  lastSyncRelative,
}: {
  totalOutstandingCompact: string;
  partyCount: number;
  reachableCount: number;
  clientCount: number;
  remindersToday: number;
  lastSyncRelative: string;
}) {
  const nodes: Node[] = [
    {
      key: "tally",
      icon: <Database className="h-4 w-4" />,
      title: "Tally Prime",
      detail: `${clientCount} ${clientCount === 1 ? "company" : "companies"}`,
      gradient: "linear-gradient(135deg, #5e5ce6, #bf5af2)",
    },
    {
      key: "connector",
      icon: <Cable className="h-4 w-4" />,
      title: "Connector",
      detail: "ODBC · 1.9s",
      gradient: "linear-gradient(135deg, #ff9f0a, #ff6b3d)",
    },
    {
      key: "cloud",
      icon: <CloudCog className="h-4 w-4" />,
      title: "Ledger Cloud",
      detail: `${partyCount.toLocaleString("en-IN")} ledgers`,
      gradient: "linear-gradient(135deg, #0a84ff, #0071e3)",
    },
    {
      key: "channels",
      icon: <MessageSquare className="h-4 w-4" />,
      title: "Channels",
      detail: `${remindersToday} today`,
      gradient: "linear-gradient(135deg, #30d158, #34c7b8)",
    },
    {
      key: "debtors",
      icon: <UserCircle2 className="h-4 w-4" />,
      title: "Debtors",
      detail: `${reachableCount} reachable`,
      gradient: "linear-gradient(135deg, #ff453a, #ff375f)",
    },
  ];

  return (
    <section className="card-apple overflow-hidden p-10">
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_auto]">
        {/* Narrative */}
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">
            How Ledger works for you
          </p>
          <h2 className="mt-3 text-[26px] font-semibold leading-[1.15] tracking-tight text-ink">
            Today, Ledger is tracking{" "}
            <span
              style={{
                background: "linear-gradient(135deg, #0a84ff, #5e5ce6 60%, #bf5af2)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              {totalOutstandingCompact}
            </span>{" "}
            across {clientCount} {clientCount === 1 ? "client" : "clients"} and{" "}
            {partyCount.toLocaleString("en-IN")} debtor{" "}
            {partyCount === 1 ? "ledger" : "ledgers"} synced from Tally.
          </h2>
          <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-ink-3">
            {reachableCount > 0 ? (
              <>
                <span className="text-ink-2">
                  {reachableCount}{" "}
                  {reachableCount === 1 ? "debtor" : "debtors"}
                </span>{" "}
                have email, WhatsApp or phone on file — reminders reach them
                automatically on the schedule you set per client.
                {partyCount > reachableCount && (
                  <>
                    {" "}
                    The other {partyCount - reachableCount} need contact
                    enrichment in Tally before Ledger can dispatch.
                  </>
                )}
              </>
            ) : (
              <>
                No debtors are digitally reachable yet. Populate email or mobile
                fields in Tally and they&apos;ll flow in on the next sync.
              </>
            )}{" "}
            <span className="text-ink-3">Last sync {lastSyncRelative}.</span>
          </p>
        </div>

        {/* Live stats panel */}
        <div className="hidden rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-2)] p-5 lg:block">
          <div className="mb-3 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-3">
            Pipeline live
          </div>
          <div className="flex items-center gap-2 text-[14px] text-ink-2">
            <span
              aria-hidden
              className="relative inline-flex h-2 w-2"
            >
              <span className="absolute inset-0 animate-ping rounded-full bg-[#30d158] opacity-60" />
              <span className="relative h-2 w-2 rounded-full bg-[#30d158]" />
            </span>
            All systems healthy
          </div>
        </div>
      </div>

      {/* Pipeline diagram */}
      <div className="mt-10 overflow-x-auto">
        <div className="flex min-w-[760px] items-stretch gap-0">
          {nodes.map((n, i) => (
            <div key={n.key} className="flex flex-1 items-center">
              <PipelineNode node={n} />
              {i < nodes.length - 1 && <PipelineConnector delay={i * 240} />}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function PipelineNode({ node }: { node: Node }) {
  return (
    <div className="flex flex-col items-center text-center">
      <div
        className="flex h-12 w-12 items-center justify-center rounded-2xl text-white shadow-[var(--shadow-apple-sm)]"
        style={{ background: node.gradient }}
        aria-hidden
      >
        {node.icon}
      </div>
      <div className="mt-3 text-[14px] font-semibold text-ink">{node.title}</div>
      <div className="tabular mt-0.5 text-[11.5px] text-ink-3">
        {node.detail}
      </div>
    </div>
  );
}

function PipelineConnector({ delay }: { delay: number }) {
  return (
    <div className="relative mx-3 h-px flex-1 overflow-hidden">
      <div className="absolute inset-y-1/2 inset-x-0 border-t border-dashed border-[var(--color-border-hair)]" />
      <span
        aria-hidden
        className="absolute top-1/2 -translate-y-1/2"
        style={{
          animation: `flow-dot 2.6s linear infinite`,
          animationDelay: `${delay}ms`,
        }}
      >
        <span
          className="block h-1.5 w-1.5 rounded-full"
          style={{
            background:
              "linear-gradient(135deg, #0a84ff, #5e5ce6)",
            boxShadow: "0 0 8px rgba(10,132,255,0.6)",
          }}
        />
      </span>
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @keyframes flow-dot {
              0%   { left: 0%;   opacity: 0; }
              10%  { opacity: 1; }
              90%  { opacity: 1; }
              100% { left: 100%; opacity: 0; }
            }
          `,
        }}
      />
    </div>
  );
}
