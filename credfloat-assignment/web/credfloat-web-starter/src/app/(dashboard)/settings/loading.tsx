import { Skeleton } from "@/components/ui/skeleton";

export default function SettingsLoading() {
  return (
    <div className="space-y-10">
      <div className="space-y-4">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-11 w-40" />
        <Skeleton className="h-4 w-72" />
      </div>

      <div className="card-apple space-y-5 p-8">
        <Skeleton className="h-5 w-20" />
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="space-y-2">
            <Skeleton className="h-3 w-14" />
            <Skeleton className="h-4 w-40" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-56" />
          </div>
        </div>
      </div>

      <div className="card-apple space-y-6 p-8">
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-6 w-24 rounded-full" />
        </div>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-7 w-24" />
            </div>
          ))}
        </div>
      </div>

      <div className="card-apple overflow-hidden">
        <div className="flex items-center justify-between px-8 pt-7 pb-5">
          <div className="space-y-2">
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-3 w-64" />
          </div>
          <Skeleton className="h-9 w-20 rounded-full" />
        </div>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className={`grid grid-cols-3 gap-4 px-8 py-4 ${i > 0 ? "border-t border-subtle" : "border-t border-subtle"}`}
          >
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-5 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}
