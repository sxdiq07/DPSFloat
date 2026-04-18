"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatDistanceToNow } from "date-fns";

export function SyncHealthDot({ lastSyncedAt }: { lastSyncedAt: string | null }) {
  const when = lastSyncedAt ? new Date(lastSyncedAt) : null;
  const now = Date.now();
  let tone: "healthy" | "stale" | "broken" | "none" = "none";
  let label = "Never synced";
  if (when) {
    const minsAgo = (now - when.getTime()) / 60_000;
    if (minsAgo < 30) tone = "healthy";
    else if (minsAgo < 180) tone = "stale";
    else tone = "broken";
    label = `Last sync ${formatDistanceToNow(when, { addSuffix: true })}`;
  }

  const colors: Record<typeof tone, string> = {
    healthy: "#30d158",
    stale: "#ff9f0a",
    broken: "#ff453a",
    none: "#86868b",
  };
  const ring = colors[tone];

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          type="button"
          aria-label={label}
          className="relative inline-flex h-2.5 w-2.5 items-center justify-center rounded-full"
        >
          {tone === "healthy" && (
            <span
              aria-hidden
              className="absolute inset-0 animate-ping rounded-full opacity-60"
              style={{ background: ring }}
            />
          )}
          <span
            aria-hidden
            className="relative h-2 w-2 rounded-full"
            style={{ background: ring }}
          />
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <div className="text-[12px]">
            <div className="font-medium">
              {tone === "healthy"
                ? "Sync healthy"
                : tone === "stale"
                  ? "Sync stale"
                  : tone === "broken"
                    ? "Sync broken"
                    : "No sync yet"}
            </div>
            <div className="opacity-70">{label}</div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
