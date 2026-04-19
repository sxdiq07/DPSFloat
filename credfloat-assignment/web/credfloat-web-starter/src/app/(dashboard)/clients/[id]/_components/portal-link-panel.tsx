"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy, Link2, RefreshCw, ShieldOff } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { generatePortalToken, revokePortalToken } from "../_actions/portal";

export type PortalTokenRow = {
  id: string;
  token: string;
  url: string;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
};

export function PortalLinkPanel({
  clientId,
  clientName,
  active,
}: {
  clientId: string;
  clientName: string;
  active: PortalTokenRow | null;
}) {
  const router = useRouter();
  const [generated, setGenerated] = useState<PortalTokenRow | null>(null);
  const [pending, startPending] = useTransition();

  const current = generated ?? active;

  const onGenerate = () => {
    startPending(async () => {
      const res = await generatePortalToken(clientId);
      if (res.ok) {
        setGenerated({
          id: "new",
          token: res.token,
          url: res.url,
          createdAt: new Date().toISOString(),
          expiresAt: res.expiresAt,
          lastUsedAt: null,
        });
        toast.success("Fresh portal link generated");
        router.refresh();
      } else toast.error(res.error);
    });
  };

  const onCopy = async () => {
    if (!current?.url) return;
    await navigator.clipboard.writeText(current.url);
    toast.success("Link copied to clipboard");
  };

  const onRevoke = () => {
    if (!active) return;
    if (!confirm("Revoke the active portal link? The client won't be able to view it anymore."))
      return;
    startPending(async () => {
      const res = await revokePortalToken(active.id);
      if (res.ok) {
        setGenerated(null);
        toast.success("Portal link revoked");
        router.refresh();
      } else toast.error(res.error);
    });
  };

  return (
    <section className="card-apple p-8">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">
            Share
          </p>
          <h2 className="mt-2 text-[22px] font-semibold tracking-tight text-ink">
            Client portal link
          </h2>
          <p className="mt-1 max-w-xl text-[14px] leading-relaxed text-ink-3">
            Generate a read-only magic link that {clientName} can open without
            logging in. Shows their receivables, ageing and top debtors. One
            active link per client; regenerating revokes the old one.
          </p>
        </div>
        <button
          type="button"
          onClick={onGenerate}
          disabled={pending}
          className="btn-apple h-9 gap-1.5 px-4 disabled:opacity-50"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {current ? "Regenerate" : "Generate link"}
        </button>
      </div>

      {current && (
        <div className="mt-6 rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-2)]/60 p-5">
          <div className="flex items-center gap-3">
            <Link2 className="h-4 w-4 shrink-0 text-ink-3" />
            <code className="min-w-0 flex-1 truncate font-mono text-[13px] text-ink-2">
              {current.url}
            </code>
            <button
              type="button"
              onClick={onCopy}
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--color-border-subtle)] bg-white px-3 text-[12.5px] font-medium text-ink-2 transition-all hover:border-[var(--color-border-hair)] hover:text-ink"
            >
              <Copy className="h-3.5 w-3.5" />
              Copy
            </button>
            {active && (
              <button
                type="button"
                onClick={onRevoke}
                disabled={pending}
                className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[rgba(255,69,58,0.25)] bg-[rgba(255,69,58,0.06)] px-3 text-[12.5px] font-medium text-[#c6373a] transition-all hover:bg-[rgba(255,69,58,0.12)]"
              >
                <ShieldOff className="h-3.5 w-3.5" />
                Revoke
              </button>
            )}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[11.5px] text-ink-3">
            <span>
              Created{" "}
              {formatDistanceToNow(new Date(current.createdAt), {
                addSuffix: true,
              })}
            </span>
            {current.expiresAt && (
              <span>
                Expires{" "}
                {formatDistanceToNow(new Date(current.expiresAt), {
                  addSuffix: true,
                })}
              </span>
            )}
            {current.lastUsedAt && (
              <span>
                Last viewed{" "}
                {formatDistanceToNow(new Date(current.lastUsedAt), {
                  addSuffix: true,
                })}
              </span>
            )}
          </div>
        </div>
      )}

      {!current && (
        <p className="mt-4 text-[13px] text-ink-3">
          No active link yet. Generating one creates a unique URL that&apos;s
          safe to email or WhatsApp to your client.
        </p>
      )}
    </section>
  );
}
