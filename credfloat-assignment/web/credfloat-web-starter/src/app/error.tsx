"use client";

import { useEffect } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-6">
      <div className="max-w-md text-center fade-in-up">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-3">
          Something went wrong
        </p>
        <h1 className="mt-3 text-[34px] font-semibold leading-tight tracking-tightest text-ink">
          We hit an unexpected error.
        </h1>
        <p className="mt-3 text-[14px] text-ink-3">
          The team has been notified. You can retry, or head back to the
          overview.
        </p>
        {error.digest && (
          <p className="mt-2 font-mono text-[11px] text-ink-3">
            Ref: {error.digest}
          </p>
        )}
        <div className="mt-8 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="btn-apple h-10 gap-1.5 px-5"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Try again
          </button>
          <Link href="/" className="btn-apple-ghost h-10 px-4">
            Back to overview
          </Link>
        </div>
      </div>
    </div>
  );
}
