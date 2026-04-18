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
        session.user.id = token.id;
        session.user.firmId = token.firmId;
        session.user.role = token.role;
      }
      return session;
    },
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const { pathname } = nextUrl;

      // Public routes (API endpoints with their own auth)
      if (
        pathname.startsWith("/api/sync") ||
        pathname.startsWith("/api/cron") ||
        pathname.startsWith("/api/auth")
      ) {
        return true;
      }

      // Login page
      if (pathname.startsWith("/login")) {
        if (isLoggedIn) return Response.redirect(new URL("/", nextUrl));
        return true;
      }

      // All other routes require auth
      return isLoggedIn;
    },
  },
} satisfies NextAuthConfig;
