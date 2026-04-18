"use client";

import { useActionState } from "react";
import { loginAction } from "./actions";

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(loginAction, undefined);

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-surface px-6">
      {/* Ambient gradient backdrop */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(ellipse 800px 600px at 50% -10%, hsl(211 100% 44% / 0.08), transparent 60%), radial-gradient(ellipse 600px 400px at 90% 100%, hsl(280 60% 60% / 0.06), transparent 60%)",
        }}
      />

      <div className="w-full max-w-[420px] fade-in-up">
        <div className="mb-10 text-center">
          <div className="mx-auto mb-6 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[hsl(211_100%_44%)] to-[hsl(211_100%_55%)] shadow-apple-md">
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
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
          <h1 className="text-[34px] font-semibold leading-tight tracking-tightest text-ink">
            Sign in to CredFloat
          </h1>
          <p className="mt-2 text-[15px] text-ink-3">
            DPS &amp; Co internal collection engine
          </p>
        </div>

        <div className="card-apple-elevated p-8">
          <form action={formAction} className="space-y-5">
            <div>
              <label
                htmlFor="email"
                className="mb-2 block text-[13px] font-medium text-ink-2"
              >
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                placeholder="you@dpsandco.in"
                className="input-apple"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="mb-2 block text-[13px] font-medium text-ink-2"
              >
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                autoComplete="current-password"
                placeholder="••••••••"
                className="input-apple"
              />
            </div>

            {state?.error && (
              <div
                className="rounded-xl border px-4 py-3 text-[13px]"
                style={{
                  borderColor: "hsl(4 100% 59% / 0.25)",
                  background: "hsl(4 100% 59% / 0.06)",
                  color: "hsl(4 72% 45%)",
                }}
              >
                {state.error}
              </div>
            )}

            <button
              type="submit"
              disabled={pending}
              className="btn-apple w-full h-11"
            >
              {pending ? "Signing in…" : "Continue"}
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
