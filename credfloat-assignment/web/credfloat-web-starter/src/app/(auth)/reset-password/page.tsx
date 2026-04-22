"use client";

import Link from "next/link";
import { Suspense, useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, CheckCircle2, Lock } from "lucide-react";
import { Label } from "@/components/ui/label";
import { resetPassword } from "./actions";

export default function ResetPasswordPage() {
  // useSearchParams forces a client-render bailout at build time.
  // Wrapping in Suspense lets Next.js still prerender the shell.
  return (
    <Suspense fallback={null}>
      <ResetPasswordInner />
    </Suspense>
  );
}

function ResetPasswordInner() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";

  const [state, formAction, pending] = useActionState(
    resetPassword,
    undefined,
  );

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-surface px-6">
      <div className="absolute inset-0 pointer-events-none" aria-hidden>
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 900px 600px at 30% 10%, rgba(0,113,227,0.10), transparent 55%), radial-gradient(ellipse 900px 600px at 70% 90%, rgba(191,90,242,0.06), transparent 55%)",
          }}
        />
      </div>
      <div className="relative w-full max-w-md fade-in-up">
        <Link
          href="/login"
          className="mb-6 inline-flex items-center gap-1.5 text-[13px] text-ink-3 transition-colors hover:text-ink"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to sign in
        </Link>

        <div className="rounded-3xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-3)] p-10 shadow-[var(--shadow-apple-md)]">
          {!token ? (
            <div className="text-center">
              <h1 className="text-[22px] font-semibold tracking-tight text-ink">
                Invalid link
              </h1>
              <p className="mt-3 text-[14.5px] text-ink-3">
                This reset link is missing its token. Request a new one from
                the sign-in page.
              </p>
              <Link
                href="/forgot-password"
                className="mt-6 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-[var(--color-accent-blue)] hover:underline"
              >
                Request a new link
              </Link>
            </div>
          ) : state?.ok ? (
            <div className="text-center">
              <div
                className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full text-emerald-700"
                style={{ background: "rgba(48,209,88,0.12)" }}
              >
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <h1 className="text-[24px] font-semibold tracking-tight text-ink">
                Password updated
              </h1>
              <p className="mt-3 text-[14.5px] leading-relaxed text-ink-3">
                You can now sign in using your new password.
              </p>
              <Link
                href="/login"
                className="mt-6 inline-flex h-11 items-center justify-center rounded-xl px-6 text-[14.5px] font-medium text-white"
                style={{
                  background:
                    "linear-gradient(180deg, #0a84ff 0%, #0071e3 100%)",
                }}
              >
                Sign in
              </Link>
            </div>
          ) : (
            <>
              <div className="mb-6">
                <div
                  className="mb-5 flex h-11 w-11 items-center justify-center rounded-[14px] text-white"
                  style={{
                    background:
                      "linear-gradient(135deg, #0a84ff 0%, #0071e3 100%)",
                    boxShadow:
                      "0 8px 20px -6px rgba(0,113,227,0.45), inset 0 1px 0 rgba(255,255,255,0.2)",
                  }}
                >
                  <Lock className="h-5 w-5" />
                </div>
                <h1 className="text-[26px] font-semibold tracking-tight text-ink">
                  Choose a new password
                </h1>
                <p className="mt-2 text-[14.5px] leading-relaxed text-ink-3">
                  Minimum 8 characters. Use something you don&apos;t use on
                  other sites.
                </p>
              </div>

              <form action={formAction} className="space-y-5">
                <input type="hidden" name="token" value={token} />

                <div className="space-y-2">
                  <Label
                    htmlFor="password"
                    className="text-[14px] font-medium text-ink-2"
                  >
                    New password
                  </Label>
                  <input
                    id="password"
                    name="password"
                    type="password"
                    required
                    minLength={8}
                    autoComplete="new-password"
                    className="h-12 w-full rounded-xl border border-[var(--color-border-hair)] bg-[var(--color-surface-2)] px-4 text-[16px] text-ink outline-none transition-all duration-150 focus:border-[var(--color-accent-blue)] focus:ring-4 focus:ring-[rgba(0,113,227,0.12)]"
                  />
                </div>

                <div className="space-y-2">
                  <Label
                    htmlFor="confirm"
                    className="text-[14px] font-medium text-ink-2"
                  >
                    Confirm new password
                  </Label>
                  <input
                    id="confirm"
                    name="confirm"
                    type="password"
                    required
                    minLength={8}
                    autoComplete="new-password"
                    className="h-12 w-full rounded-xl border border-[var(--color-border-hair)] bg-[var(--color-surface-2)] px-4 text-[16px] text-ink outline-none transition-all duration-150 focus:border-[var(--color-accent-blue)] focus:ring-4 focus:ring-[rgba(0,113,227,0.12)]"
                  />
                </div>

                {state?.error && (
                  <div
                    className="rounded-xl border px-4 py-3 text-[14px]"
                    style={{
                      borderColor: "rgba(255,59,48,0.25)",
                      background: "rgba(255,59,48,0.06)",
                      color: "#b91c1c",
                    }}
                  >
                    {state.error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={pending}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-xl text-[15.5px] font-medium text-white transition-all duration-200 disabled:pointer-events-none disabled:opacity-50"
                  style={{
                    background:
                      "linear-gradient(180deg, #0a84ff 0%, #0071e3 100%)",
                    boxShadow:
                      "0 1px 0 rgba(255,255,255,0.25) inset, 0 4px 14px -2px rgba(0,113,227,0.35)",
                  }}
                >
                  {pending ? "Updating…" : "Update password"}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
