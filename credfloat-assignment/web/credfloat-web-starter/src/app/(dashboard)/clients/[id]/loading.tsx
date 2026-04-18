import { Skeleton } from "@/components/ui/skeleton";

export default function ClientDetailLoading() {
  return (
    <div className="space-y-10">
      <div className="space-y-4">
        <Skeleton className="h-3 w-36" />
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-11 w-80 max-w-full" />
        <Skeleton className="h-4 w-72" />
      </div>

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

      <div className="card-apple p-8 space-y-6">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-6 w-56" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="space-y-2">
              <div className="flex items-baseline justify-between">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-3 w-12" />
              </div>
              <Skeleton className="h-1.5 w-full rounded-full" />
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-2">
        <Skeleton className="h-9 w-24 rounded-lg" />
        <Skeleton className="h-9 w-24 rounded-lg" />
        <Skeleton className="h-9 w-28 rounded-lg" />
      </div>

      <div className="card-apple overflow-hidden">
        <div className="border-b border-subtle px-8 py-4">
          <div className="grid grid-cols-3 gap-4">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-20 justify-self-end" />
          </div>
        </div>
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={`grid grid-cols-3 gap-4 px-8 py-4 ${i > 0 ? "border-t border-subtle" : ""}`}
          >
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-4 w-24 justify-self-end" />
          </div>
        ))}
      </div>
    </div>
  );
}
