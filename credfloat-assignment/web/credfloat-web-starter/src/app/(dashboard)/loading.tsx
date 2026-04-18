import { Skeleton } from "@/components/ui/skeleton";

export default function OverviewLoading() {
  return (
    <div className="space-y-14">
      {/* Header */}
      <div className="space-y-4">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-11 w-48" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>

      {/* Hero */}
      <div className="card-apple p-10">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="mt-4 h-20 w-2/3" />
        <Skeleton className="mt-5 h-4 w-72" />
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="rounded-[18px] border border-[var(--color-border-subtle)] bg-white p-7"
          >
            <div className="flex items-center justify-between">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-2 w-2 rounded-full" />
            </div>
            <Skeleton className="mt-5 h-8 w-32" />
            <Skeleton className="mt-3 h-3 w-40" />
          </div>
        ))}
      </div>

      {/* Ageing */}
      <div className="card-apple p-10">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="mt-2 h-7 w-72" />
        <Skeleton className="mt-1.5 h-3 w-96 max-w-full" />
        <Skeleton className="mt-8 h-3 w-full rounded-full" />
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-5">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-start gap-2">
              <Skeleton className="mt-1 h-2 w-2 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3 w-14" />
                <Skeleton className="h-4 w-20" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Top clients */}
      <div className="card-apple overflow-hidden">
        <div className="px-10 pt-9 pb-6">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-2 h-7 w-80" />
        </div>
        <div className="border-t border-subtle">
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className={`flex items-center gap-5 px-10 py-5 ${i > 0 ? "border-t border-subtle" : ""}`}
            >
              <Skeleton className="h-10 w-10 rounded-xl" />
              <div className="flex-1 space-y-2">
                <div className="flex items-baseline justify-between">
                  <Skeleton className="h-4 w-44" />
                  <Skeleton className="h-4 w-24" />
                </div>
                <Skeleton className="h-1 w-full rounded-full" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
