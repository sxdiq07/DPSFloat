"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Overview" },
  { href: "/clients", label: "Clients" },
  { href: "/reports", label: "Reports" },
  { href: "/settings", label: "Settings" },
];

export function NavLinks() {
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname?.startsWith(href);

  return (
    <nav className="hidden items-center gap-1 md:flex">
      {links.map((link) => {
        const active = isActive(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={[
              "relative rounded-full px-3.5 py-1.5 text-[14px] font-medium transition-colors duration-150",
              active ? "text-ink" : "text-ink-3 hover:text-ink",
            ].join(" ")}
          >
            {link.label}
            {active && (
              <span
                aria-hidden
                className="absolute inset-0 -z-10 rounded-full"
                style={{ background: "hsl(240 14% 96.5%)" }}
              />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
