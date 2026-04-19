import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-6">
      <div className="max-w-md text-center fade-in-up">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-3">
          404
        </p>
        <h1 className="mt-3 text-[34px] font-semibold leading-tight tracking-tightest text-ink">
          We couldn&apos;t find that page.
        </h1>
        <p className="mt-3 text-[15px] text-ink-3">
          The URL may be mistyped, or a client you&apos;re looking for has been
          archived.
        </p>
        <div className="mt-8">
          <Link href="/" className="btn-apple h-10 px-5">
            Back to overview
          </Link>
        </div>
      </div>
    </div>
  );
}
