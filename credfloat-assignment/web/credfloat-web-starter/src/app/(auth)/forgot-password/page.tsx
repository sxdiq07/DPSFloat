"use client";

import Link from "next/link";
import { useActionState } from "react";
import { ArrowLeft, CheckCircle2, Mail } from "lucide-react";
import { Label } from "@/components/ui/label";
import { requestPasswordReset } from "./actions";

export default function ForgotPasswordPage() {
  const [state, formAction, pending] = useActionState(
    requestPasswordReset,
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
          {state?.ok ? (
            <div className="text-center">
              <div
                className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full text-emerald-700"
                style={{ background: "rgba(48,209,88,0.12)" }}
              >
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <h1 className="text-[24px] font-semibold tracking-tight text-ink">
                Check your inbox
              </h1>
              <p className="mt-3 text-[14.5px] leading-relaxed text-ink-3">
                If an account exists for that email, we&apos;ve sent a
                password-reset link. The link is valid for one hour and can
                only be used once.
              </p>
              <Link
                href="/login"
                className="mt-6 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-[var(--color-accent-blue)] hover:underline"
              >
                Return to sign in
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
                  <Mail className="h-5 w-5" />
                </div>
                <h1 className="text-[26px] font-semibold tracking-tight text-ink">
                  Forgot your password?
                </h1>
                <p className="mt-2 text-[14.5px] leading-relaxed text-ink-3">
                  Enter the email you use for Ledger and we&apos;ll send you a
                  reset link.
                </p>
              </div>

              <form action={formAction} className="space-y-5">
                <div className="space-y-2">
                  <Label
                    htmlFor="email"
                    className="text-[14px] font-medium text-ink-2"
                  >
                    Email
                  </Label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    required
                    autoComplete="email"
                    placeholder="you@dpsandco.in"
                    className="h-12 w-full rounded-xl border border-[var(--color-border-hair)] bg-[var(--color-surface-2)] px-4 text-[16px] text-ink outline-none transition-all duration-150 placeholder:text-ink-3 focus:border-[var(--color-accent-blue)] focus:ring-4 focus:ring-[rgba(0,113,227,0.12)]"
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
                  {pending ? "Sending…" : "Send reset link"}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
