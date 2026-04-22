import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe NextAuth config. Used by middleware where Prisma isn't available.
 * The full config with the Credentials provider lives in auth.ts.
 */
export const authConfig = {
  pages: { signIn: "/login" },
  providers: [], // populated in auth.ts
  session: { strategy: "jwt" },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
        token.firmId = user.firmId;
        token.role = user.role;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.firmId = token.firmId as string;
        session.user.role = token.role as "PARTNER" | "STAFF";
      }
      return session;
    },
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const { pathname } = nextUrl;

      // Public routes (API endpoints with their own auth + token-gated portal)
      if (
        pathname.startsWith("/api/sync") ||
        pathname.startsWith("/api/cron") ||
        pathname.startsWith("/api/auth") ||
        pathname.startsWith("/api/webhooks/") ||
        pathname.startsWith("/portal/")
      ) {
        return true;
      }

      // Unauth-only routes (login + password reset flow)
      if (
        pathname.startsWith("/login") ||
        pathname.startsWith("/forgot-password") ||
        pathname.startsWith("/reset-password")
      ) {
        if (isLoggedIn && pathname.startsWith("/login"))
          return Response.redirect(new URL("/", nextUrl));
        return true;
      }

      // All other routes require auth
      return isLoggedIn;
    },
  },
} satisfies NextAuthConfig;
