import Link from "next/link";
import { ChevronRight } from "lucide-react";

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  crumbs,
  action,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  crumbs?: { label: string; href?: string }[];
  action?: React.ReactNode;
}) {
  return (
    <header className="space-y-4">
      {crumbs && crumbs.length > 0 && (
        <nav className="flex items-center gap-1.5 text-[12px] text-ink-3">
          {crumbs.map((c, i) => (
            <span key={i} className="flex items-center gap-1.5">
              {c.href ? (
                <Link
                  href={c.href}
                  className="transition-colors hover:text-ink"
                >
                  {c.label}
                </Link>
              ) : (
                <span className="text-ink-2">{c.label}</span>
              )}
              {i < crumbs.length - 1 && (
                <ChevronRight className="h-3 w-3 text-ink-3/60" />
              )}
            </span>
          ))}
        </nav>
      )}

      <div className="flex items-end justify-between gap-6">
        <div className="space-y-2">
          {eyebrow && (
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-3">
              {eyebrow}
            </p>
          )}
          <h1 className="text-[44px] font-semibold leading-[1.05] tracking-tightest text-ink">
            {title}
          </h1>
          {subtitle && (
            <p className="max-w-2xl pt-1 text-[16px] leading-relaxed text-ink-3">
              {subtitle}
            </p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    </header>
  );
}
