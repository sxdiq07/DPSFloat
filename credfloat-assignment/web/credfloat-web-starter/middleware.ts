import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";

export default NextAuth(authConfig).auth;

export const config = {
  matcher: [
    // Skip edge middleware on routes that do their own auth (bearer token
    // for sync/cron, token-gated portal, NextAuth's own handler) and on
    // static assets.
    "/((?!api/sync|api/cron|api/auth|api/webhooks|portal/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
