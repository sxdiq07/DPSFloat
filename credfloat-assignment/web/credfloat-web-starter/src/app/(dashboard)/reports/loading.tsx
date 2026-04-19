import { Skeleton } from "@/components/ui/skeleton";

export default function ReportsLoading() {
  return (
    <div className="space-y-10">
      <div className="space-y-4">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-11 w-40" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="card-apple space-y-5 p-8 lg:col-span-3">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-6 w-72" />
          <Skeleton className="h-[280px] w-full rounded-xl" />
        </div>
        <div className="card-apple space-y-4 p-8 lg:col-span-2">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-6 w-56" />
          <Skeleton className="mx-auto h-[240px] w-[240px] rounded-full" />
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex justify-between">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-3 w-24" />
            </div>
          ))}
        </div>
      </div>

      <div className="card-apple overflow-hidden">
        <div className="space-y-3 px-8 pt-8 pb-5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-6 w-80" />
        </div>
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className={`grid grid-cols-[1fr_auto] gap-5 px-8 py-4 ${i > 0 ? "border-t border-subtle" : "border-t border-subtle"}`}
          >
            <div className="space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-1.5 w-full rounded-full" />
            </div>
            <div className="space-y-1 text-right">
              <Skeleton className="ml-auto h-4 w-14" />
              <Skeleton className="ml-auto h-3 w-20" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
