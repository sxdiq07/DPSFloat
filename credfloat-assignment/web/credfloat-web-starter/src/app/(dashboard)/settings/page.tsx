import { prisma } from "@/lib/prisma";
import { requireFirmId } from "@/lib/session";
import { formatDistanceToNow } from "date-fns";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const firmId = await requireFirmId();

  const [firm, staff, clientCount, partyCount, lastSync] = await Promise.all([
    prisma.firm.findUnique({ where: { id: firmId } }),
    prisma.firmStaff.findMany({
      where: { firmId },
      orderBy: { createdAt: "asc" },
    }),
    prisma.clientCompany.count({ where: { firmId } }),
    prisma.party.count({ where: { clientCompany: { firmId } } }),
    prisma.party.findFirst({
      where: { clientCompany: { firmId } },
      orderBy: { lastSyncedAt: "desc" },
      select: { lastSyncedAt: true },
    }),
  ]);

  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow="Administration"
        title="Settings"
        subtitle="Firm information, sync health, and staff access."
      />

      {/* Firm */}
      <section className="card-apple p-8">
        <h2 className="text-[18px] font-semibold text-ink">Firm</h2>
        <dl className="mt-5 grid grid-cols-1 gap-6 md:grid-cols-2">
          <div>
            <dt className="text-[12px] font-medium uppercase tracking-[0.08em] text-ink-3">
              Name
            </dt>
            <dd className="mt-1.5 text-[15px] font-medium text-ink">
              {firm?.name}
            </dd>
          </div>
          <div>
            <dt className="text-[12px] font-medium uppercase tracking-[0.08em] text-ink-3">
              Firm ID
            </dt>
            <dd className="mt-1.5 font-mono text-[12px] text-ink-2">
              {firm?.id}
            </dd>
          </div>
        </dl>
      </section>

      {/* Sync health */}
      <section className="card-apple p-8">
        <div className="flex items-start justify-between">
          <h2 className="text-[18px] font-semibold text-ink">Sync health</h2>
          <StatusIndicator ok={Boolean(lastSync?.lastSyncedAt)} />
        </div>
        <dl className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-3">
          <HealthStat label="Client companies" value={`${clientCount}`} />
          <HealthStat label="Parties synced" value={`${partyCount}`} />
          <HealthStat
            label="Last sync"
            value={
              lastSync?.lastSyncedAt
                ? formatDistanceToNow(lastSync.lastSyncedAt, { addSuffix: true })
                : "Never"
            }
            mono={false}
          />
        </dl>
      </section>

      {/* Staff */}
      <section className="card-apple overflow-hidden">
        <div className="flex items-end justify-between px-8 pt-7 pb-5">
          <div>
            <h2 className="text-[18px] font-semibold text-ink">Staff</h2>
            <p className="mt-1 text-[13px] text-ink-3">
              Partners see all clients; staff see assigned clients (Phase 2).
            </p>
          </div>
        </div>
        <table className="w-full border-t border-subtle text-[14px]">
          <thead>
            <tr className="text-[11px] uppercase tracking-[0.08em] text-ink-3">
              <th className="px-8 py-3 text-left font-medium">Name</th>
              <th className="px-8 py-3 text-left font-medium">Email</th>
              <th className="px-8 py-3 text-left font-medium">Role</th>
            </tr>
          </thead>
          <tbody>
            {staff.map((s, i) => (
              <tr
                key={s.id}
                className={`row-interactive ${i > 0 ? "border-t border-subtle" : "border-t border-subtle"}`}
              >
                <td className="px-8 py-4 font-medium text-ink">{s.name}</td>
                <td className="px-8 py-4 text-ink-2">{s.email}</td>
                <td className="px-8 py-4">
                  <RolePill role={s.role} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function StatusIndicator({ ok }: { ok: boolean }) {
  return (
    <span
      className="pill"
      style={{
        background: ok ? "hsl(142 60% 94%)" : "hsl(44 100% 93%)",
        color: ok ? "hsl(142 64% 24%)" : "hsl(32 80% 30%)",
      }}
    >
      <span
        aria-hidden
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: ok ? "hsl(142 64% 42%)" : "hsl(32 100% 52%)" }}
      />
      {ok ? "Healthy" : "No sync yet"}
    </span>
  );
}

function HealthStat({
  label,
  value,
  mono = true,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-[12px] font-medium uppercase tracking-[0.08em] text-ink-3">
        {label}
      </dt>
      <dd
        className={`mt-2 text-[22px] font-semibold leading-none tracking-tight text-ink ${mono ? "tabular" : ""}`}
      >
        {value}
      </dd>
    </div>
  );
}

function RolePill({ role }: { role: string }) {
  const isPartner = role === "PARTNER";
  return (
    <span
      className="pill"
      style={{
        background: isPartner ? "hsl(211 100% 95%)" : "hsl(240 9% 94%)",
        color: isPartner ? "hsl(211 86% 32%)" : "hsl(240 3% 36%)",
      }}
    >
      {role.toLowerCase()}
    </span>
  );
}
