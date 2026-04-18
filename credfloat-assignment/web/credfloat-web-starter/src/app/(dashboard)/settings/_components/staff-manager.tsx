"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Label } from "@/components/ui/label";
import { addStaff, removeStaff } from "../_actions/staff";

type StaffRow = {
  id: string;
  name: string;
  email: string;
  role: "PARTNER" | "STAFF";
  isSelf: boolean;
};

export function StaffManager({
  staff,
  canManage,
}: {
  staff: StaffRow[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"PARTNER" | "STAFF">("STAFF");
  const [pending, startPending] = useTransition();

  const onAdd = () => {
    startPending(async () => {
      const res = await addStaff({ name, email, password, role });
      if (res.ok) {
        toast.success(`${name} added as ${role.toLowerCase()}`);
        setName("");
        setEmail("");
        setPassword("");
        setRole("STAFF");
        setShowForm(false);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  const onRemove = (row: StaffRow) => {
    if (!confirm(`Remove ${row.name}? Access is revoked immediately.`)) return;
    startPending(async () => {
      const res = await removeStaff(row.id);
      if (res.ok) {
        toast.success(`${row.name} removed`);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  return (
    <section className="card-apple overflow-hidden">
      <div className="flex items-end justify-between gap-4 px-8 pt-7 pb-5">
        <div>
          <h2 className="text-[18px] font-semibold text-ink">Staff</h2>
          <p className="mt-1 text-[13px] text-ink-3">
            Partners see every client. Staff see assigned clients (Phase 2).
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="btn-apple h-9 gap-1.5 px-4"
          >
            <Plus className="h-3.5 w-3.5" />
            {showForm ? "Cancel" : "Invite"}
          </button>
        )}
      </div>

      {showForm && canManage && (
        <div className="border-t border-subtle bg-[var(--color-surface-2)]/40 px-8 py-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="staff-name" className="text-[12px] text-ink-2">
                Name
              </Label>
              <input
                id="staff-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Full name"
                className="h-10 w-full rounded-xl border border-[var(--color-border-hair)] bg-[var(--color-surface-3)] px-3.5 text-[13px] outline-none transition-all placeholder:text-ink-3 focus:border-[var(--color-accent-blue)] focus:ring-4 focus:ring-[rgba(0,113,227,0.12)]"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="staff-email" className="text-[12px] text-ink-2">
                Email
              </Label>
              <input
                id="staff-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="staff@dpsandco.in"
                className="h-10 w-full rounded-xl border border-[var(--color-border-hair)] bg-[var(--color-surface-3)] px-3.5 text-[13px] outline-none transition-all placeholder:text-ink-3 focus:border-[var(--color-accent-blue)] focus:ring-4 focus:ring-[rgba(0,113,227,0.12)]"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="staff-pass" className="text-[12px] text-ink-2">
                Temporary password
              </Label>
              <input
                id="staff-pass"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Min 8 chars"
                className="h-10 w-full rounded-xl border border-[var(--color-border-hair)] bg-[var(--color-surface-3)] px-3.5 text-[13px] outline-none transition-all placeholder:text-ink-3 focus:border-[var(--color-accent-blue)] focus:ring-4 focus:ring-[rgba(0,113,227,0.12)]"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[12px] text-ink-2">Role</Label>
              <div className="flex items-center gap-1 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-3)] p-1 text-[12.5px]">
                {(["PARTNER", "STAFF"] as const).map((r) => {
                  const active = role === r;
                  return (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setRole(r)}
                      className={`flex-1 rounded-lg px-3 py-1.5 font-medium transition-all ${
                        active
                          ? "bg-[var(--color-surface-2)] text-ink shadow-[var(--shadow-apple-sm)]"
                          : "text-ink-3 hover:text-ink"
                      }`}
                    >
                      {r.toLowerCase()}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={onAdd}
              disabled={pending}
              className="btn-apple h-9 px-5 disabled:opacity-50"
            >
              {pending ? "Adding…" : "Add staff"}
            </button>
          </div>
        </div>
      )}

      <table className="w-full border-t border-subtle text-[14px]">
        <thead>
          <tr className="text-[11px] uppercase tracking-[0.08em] text-ink-3">
            <th className="px-8 py-3 text-left font-medium">Name</th>
            <th className="px-8 py-3 text-left font-medium">Email</th>
            <th className="px-8 py-3 text-left font-medium">Role</th>
            <th className="w-10 px-4"></th>
          </tr>
        </thead>
        <tbody>
          {staff.map((s, i) => (
            <tr
              key={s.id}
              className={`row-interactive group ${i > 0 ? "border-t border-subtle" : "border-t border-subtle"}`}
            >
              <td className="px-8 py-4 font-medium text-ink">
                {s.name}
                {s.isSelf && (
                  <span className="ml-2 text-[10.5px] uppercase tracking-[0.12em] text-ink-3">
                    You
                  </span>
                )}
              </td>
              <td className="px-8 py-4 text-ink-2">{s.email}</td>
              <td className="px-8 py-4">
                <RolePill role={s.role} />
              </td>
              <td className="px-2 py-4">
                {canManage && !s.isSelf && (
                  <button
                    type="button"
                    onClick={() => onRemove(s)}
                    disabled={pending}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-3 opacity-0 transition-all hover:bg-[rgba(255,69,58,0.10)] hover:text-[#c6373a] group-hover:opacity-100 disabled:opacity-30"
                    aria-label={`Remove ${s.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function RolePill({ role }: { role: "PARTNER" | "STAFF" }) {
  const isPartner = role === "PARTNER";
  return (
    <span
      className="pill"
      style={{
        background: isPartner ? "rgba(10,132,255,0.10)" : "rgba(134,134,139,0.12)",
        color: isPartner ? "#0057b7" : "var(--color-ink-2)",
      }}
    >
      {role.toLowerCase()}
    </span>
  );
}
