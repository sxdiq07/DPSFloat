"use client";

import { useActionState } from "react";
import { loginAction } from "./actions";
import { Label } from "@/components/ui/label";
import {
  ArrowRight,
  Zap,
  MessageCircle,
  BarChart3,
  ShieldCheck,
} from "lucide-react";

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(loginAction, undefined);

  return (
    <div className="relative min-h-screen overflow-hidden bg-surface">
      {/* Global ambient backdrop */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 1000px 700px at 12% 0%, rgba(0,113,227,0.10), transparent 55%), radial-gradient(ellipse 900px 600px at 88% 15%, rgba(191,90,242,0.08), transparent 55%), radial-gradient(ellipse 1200px 600px at 50% 110%, rgba(48,209,88,0.05), transparent 55%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.018]"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")",
        }}
      />

      <div className="relative mx-auto flex min-h-screen max-w-7xl">
        {/* Left — form */}
        <div className="flex w-full flex-col justify-center px-6 py-12 md:w-[48%] md:px-16 lg:w-[45%]">
          <div className="w-full max-w-[420px] fade-in-up">
            <div className="mb-12">
              <div
                className="mb-8 flex h-12 w-12 items-center justify-center rounded-[16px] text-white"
                style={{
                  background:
                    "linear-gradient(135deg, #0a84ff 0%, #0071e3 50%, #0040dd 100%)",
                  boxShadow:
                    "0 10px 30px -8px rgba(0,113,227,0.5), 0 2px 4px rgba(0,0,0,0.04), inset 0 1px 0 rgba(255,255,255,0.2)",
                }}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
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
              <h1 className="text-[40px] font-semibold leading-[1.05] tracking-tightest text-ink">
                Sign in to Ledger
              </h1>
              <p className="mt-3 text-[16px] text-ink-3">
                The intelligent layer on top of your Tally ledger.
              </p>
            </div>

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
                  className="h-12 w-full rounded-xl border border-[var(--color-border-hair)] bg-[var(--color-surface-3)] px-4 text-[15px] text-ink outline-none transition-all duration-150 placeholder:text-ink-3 focus:border-[var(--color-accent-blue)] focus:ring-4 focus:ring-[rgba(0,113,227,0.12)]"
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
                  className="h-12 w-full rounded-xl border border-[var(--color-border-hair)] bg-[var(--color-surface-3)] px-4 text-[15px] text-ink outline-none transition-all duration-150 placeholder:text-ink-3 focus:border-[var(--color-accent-blue)] focus:ring-4 focus:ring-[rgba(0,113,227,0.12)]"
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

            <p className="mt-8 text-[12.5px] text-ink-3">
              Access is restricted to authorised firm staff. Every reminder and
              sync action is audited.
            </p>
          </div>
        </div>

        {/* Right — product showcase */}
        <div className="relative hidden md:flex md:w-[52%] md:items-center md:pr-16 lg:w-[55%]">
          {/* Accent column gradient */}
          <div
            aria-hidden
            className="absolute inset-y-12 right-16 left-0 -z-10 rounded-[32px]"
            style={{
              background:
                "linear-gradient(160deg, rgba(0,113,227,0.04) 0%, rgba(191,90,242,0.04) 60%, rgba(48,209,88,0.03) 100%)",
            }}
          />

          <div className="w-full pl-8 lg:pl-16">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-3 fade-in-up">
              An internal tool built for DPS &amp; Co
            </p>
            <h2
              className="mt-4 font-semibold leading-[0.95] tracking-tightest text-ink fade-in-up"
              style={{ fontSize: "clamp(44px, 6vw, 76px)" }}
            >
              Every debtor.
              <br />
              <span
                style={{
                  background:
                    "linear-gradient(135deg, #0a84ff, #5e5ce6 40%, #bf5af2)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                }}
              >
                One glance.
              </span>
            </h2>
            <p
              className="mt-5 max-w-lg text-[16px] leading-relaxed text-ink-2 fade-in-up"
              style={{ animationDelay: "80ms" }}
            >
              Ledger reads straight from your Tally installs, flags who owes
              what, and sends the reminders — so the firm&apos;s team can focus
              on the conversations that actually move money.
            </p>

            <div className="mt-10 space-y-3">
              <FeatureCard
                delay={160}
                icon={<Zap className="h-4 w-4" />}
                gradient="linear-gradient(135deg, #0a84ff, #5e5ce6)"
                title="Tally sync in seconds"
                body="Bulk-upsert via ON CONFLICT — 73 debtors land in 1.9 s against the cloud."
              />
              <FeatureCard
                delay={240}
                icon={<MessageCircle className="h-4 w-4" />}
                gradient="linear-gradient(135deg, #30d158, #34c7b8)"
                title="Reminders on autopilot"
                body="Email, WhatsApp, SMS dispatched on each client&apos;s own schedule, opt-outs honoured."
              />
              <FeatureCard
                delay={320}
                icon={<BarChart3 className="h-4 w-4" />}
                gradient="linear-gradient(135deg, #ff9f0a, #ff6b3d)"
                title="Ageing at a glance"
                body="IST-accurate buckets recomputed daily. Who&apos;s 30, 60, 90+ days late — one scroll."
              />
              <FeatureCard
                delay={400}
                icon={<ShieldCheck className="h-4 w-4" />}
                gradient="linear-gradient(135deg, #64748b, #475569)"
                title="Private to your firm"
                body="Multi-tenant schema, row-level tenant scoping on every query, DPDP-aware audit log."
              />
            </div>

            <div
              className="mt-10 flex items-center gap-6 text-[12px] text-ink-3 fade-in-up"
              style={{ animationDelay: "480ms" }}
            >
              <Stat label="Debtor ledgers" value="300+" />
              <Separator />
              <Stat label="Channels" value="3" />
              <Separator />
              <Stat label="Compliance" value="DPDP · DLT" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function FeatureCard({
  icon,
  gradient,
  title,
  body,
  delay,
}: {
  icon: React.ReactNode;
  gradient: string;
  title: string;
  body: string;
  delay: number;
}) {
  return (
    <div
      className="group flex max-w-xl items-start gap-4 rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-3)] p-4 transition-all duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] hover:-translate-y-0.5 hover:shadow-[var(--shadow-apple-md)] fade-in-up"
      style={{
        animationDelay: `${delay}ms`,
      }}
    >
      <div
        aria-hidden
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white shadow-[var(--shadow-apple-sm)]"
        style={{ background: gradient }}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-semibold tracking-tight text-ink">
          {title}
        </div>
        <div className="mt-1 text-[12.5px] leading-relaxed text-ink-3">
          {body}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="tabular text-[14px] font-semibold text-ink">{value}</div>
      <div className="text-[10.5px] uppercase tracking-[0.14em] text-ink-3">
        {label}
      </div>
    </div>
  );
}

function Separator() {
  return (
    <span
      aria-hidden
      className="h-6 w-px"
      style={{ background: "var(--color-border-subtle)" }}
    />
  );
}
