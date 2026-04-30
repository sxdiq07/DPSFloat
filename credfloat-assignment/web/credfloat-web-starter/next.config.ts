import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
    // Client-side Router Cache: reuse the RSC payload when navigating
    // between pages within the window. A hard refresh (Ctrl+R) bypasses
    // the cache and always re-fetches, so users still see fresh data
    // when they explicitly ask for it.
    staleTimes: {
      dynamic: 120, // seconds — covers Overview, Clients, Reports during a normal session
      static: 300,
    },
  },
  // @react-pdf/renderer ships its own React-like reconciler. Next.js
  // bundling duplicates React internals and trips that reconciler
  // ("Minified React error #31" on renderToBuffer). Declaring the
  // package as a server external tells Next to `require()` it at
  // runtime without re-bundling, so the reconciler sees the same
  // React instance the JSX was built against.
  serverExternalPackages: ["@react-pdf/renderer"],
};

export default nextConfig;
