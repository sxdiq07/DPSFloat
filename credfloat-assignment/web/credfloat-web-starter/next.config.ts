import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
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
