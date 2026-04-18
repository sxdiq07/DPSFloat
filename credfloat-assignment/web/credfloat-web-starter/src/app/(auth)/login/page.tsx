"use client";

import { useActionState } from "react";
import { loginAction } from "./actions";
import { Label } from "@/components/ui/label";
import { ArrowRight } from "lucide-react";

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(loginAction, undefined);

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-surface px-6">
      {/* Multi-stop mesh gradient backdrop */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(ellipse 900px 650px at 15% 0%, rgba(0,113,227,0.10), transparent 55%), radial-gradient(ellipse 700px 500px at 95% 20%, rgba(191,90,242,0.08), transparent 55%), radial-gradient(ellipse 1000px 600px at 50% 110%, rgba(48,209,88,0.05), transparent 55%)",
        }}
      />

      {/* Noise for depth */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-[0.015]"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")",
        }}
      />

      <div className="w-full max-w-[440px] fade-in-up">
        {/* Brand mark */}
        <div className="mb-12 flex flex-col items-center">
          <div
            className="mb-6 flex h-14 w-14 items-center justify-center rounded-[18px] text-white"
            style={{
              background:
                "linear-gradient(135deg, #0a84ff 0%, #0071e3 50%, #0040dd 100%)",
              boxShadow:
                "0 10px 30px -8px rgba(0,113,227,0.5), 0 2px 4px rgba(0,0,0,0.04), inset 0 1px 0 rgba(255,255,255,0.2)",
            }}
          >
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
              <path
                d="M4 7c0-1.1.9-2 2-2h10l4 4v8c0 1.1-.9 2-2 2H6c-1.1 0-2-.9-2-2V7z"
                stroke="white"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M8 12h8M8 16h5"
                stroke="white"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <h1 className="text-center text-[40px] font-semibold leading-[1.08] tracking-tightest text-ink">
            Sign in to CredFloat
          </h1>
          <p className="mt-3 text-center text-[16px] text-ink-3">
            DPS &amp; Co internal collection engine
          </p>
        </div>

        {/* Form card */}
        <div
          className="rounded-[20px] bg-white p-10"
          style={{ boxShadow: "var(--shadow-apple-md)" }}
        >
          <form action={formAction} className="space-y-5">
            <div className="space-y-2">
              <Label
                htmlFor="email"
                className="text-[13px] font-medium text-ink-2"
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
                className="h-12 w-full rounded-xl border border-[var(--color-border-hair)] bg-white px-4 text-[15px] text-ink outline-none transition-all duration-150 placeholder:text-ink-3 focus:border-[var(--color-accent-blue)] focus:ring-4 focus:ring-[rgba(0,113,227,0.12)]"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label
                  htmlFor="password"
                  className="text-[13px] font-medium text-ink-2"
                >
                  Password
                </Label>
                <a
                  href="#"
                  className="text-[12px] font-medium text-[var(--color-accent-blue)] hover:underline"
                  tabIndex={-1}
                >
                  Forgot?
                </a>
              </div>
              <input
                id="password"
                name="password"
                type="password"
                required
                autoComplete="current-password"
                placeholder="••••••••"
                className="h-12 w-full rounded-xl border border-[var(--color-border-hair)] bg-white px-4 text-[15px] text-ink outline-none transition-all duration-150 placeholder:text-ink-3 focus:border-[var(--color-accent-blue)] focus:ring-4 focus:ring-[rgba(0,113,227,0.12)]"
              />
            </div>

            {state?.error && (
              <div
                className="rounded-xl border px-4 py-3 text-[13px]"
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
              className="group relative flex h-12 w-full items-center justify-center gap-2 rounded-xl text-[15px] font-medium text-white transition-all duration-200 disabled:pointer-events-none disabled:opacity-50"
              style={{
                background:
                  "linear-gradient(180deg, #0a84ff 0%, #0071e3 100%)",
                boxShadow:
                  "0 1px 0 rgba(255,255,255,0.25) inset, 0 4px 14px -2px rgba(0,113,227,0.35)",
              }}
            >
              {pending ? "Signing in…" : "Continue"}
              {!pending && (
                <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
              )}
            </button>
          </form>
        </div>

        <p className="mt-8 text-center text-[13px] text-ink-3">
          Need help? Contact your firm administrator.
        </p>
      </div>
    </div>
  );
}
