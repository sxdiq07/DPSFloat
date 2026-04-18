import { Skeleton } from "@/components/ui/skeleton";

export default function ClientsLoading() {
  return (
    <div className="space-y-10">
      <div className="space-y-4">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-11 w-40" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>

      <div className="card-apple overflow-hidden">
        <div className="border-b border-subtle px-8 py-4">
          <div className="grid grid-cols-6 gap-4">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-3 w-20" />
            ))}
          </div>
        </div>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className={`grid grid-cols-6 gap-4 px-8 py-5 ${i > 0 ? "border-t border-subtle" : ""}`}
          >
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-24 justify-self-end" />
            <Skeleton className="h-4 w-20 justify-self-end" />
            <Skeleton className="h-4 w-8 justify-self-end" />
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-4 w-28" />
          </div>
        ))}
      </div>
    </div>
  );
}
