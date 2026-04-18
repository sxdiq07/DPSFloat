import { prisma } from "@/lib/prisma";
import { requireAuth, requireFirmId } from "@/lib/session";
import { formatDistanceToNow } from "date-fns";
import { PageHeader } from "@/components/ui/page-header";
import { StaffManager } from "./_components/staff-manager";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await requireAuth();
  const firmId = await requireFirmId();

  const [firm, staff, clientCount, partyCount, lastSync] = await Promise.all([
    prisma.firm.findUnique({ where: { id: firmId } }),
    prisma.firmStaff.findMany({
      where: { firmId },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    }),
    prisma.clientCompany.count({ where: { firmId } }),
    prisma.party.count({ where: { clientCompany: { firmId } } }),
    prisma.party.findFirst({
      where: { clientCompany: { firmId } },
      orderBy: { lastSyncedAt: "desc" },
      select: { lastSyncedAt: true },
    }),
  ]);

  const canManage = session.user.role === "PARTNER";

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
      <StaffManager
        staff={staff.map((s) => ({
          id: s.id,
          name: s.name,
          email: s.email,
          role: s.role,
          isSelf: s.id === session.user.id,
        }))}
        canManage={canManage}
      />
    </div>
  );
}

function StatusIndicator({ ok }: { ok: boolean }) {
  return (
    <span
      className="pill"
      style={{
        background: ok ? "rgba(48,209,88,0.14)" : "rgba(255,159,10,0.14)",
        color: ok ? "#1f7a4a" : "#9c5700",
      }}
    >
      <span
        aria-hidden
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: ok ? "#30d158" : "#ff9f0a" }}
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
