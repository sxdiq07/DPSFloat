import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      firmId: string;
      role: "PARTNER" | "STAFF";
    } & DefaultSession["user"];
  }

  interface User {
    id: string;
    firmId: string;
    role: "PARTNER" | "STAFF";
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    firmId: string;
    role: "PARTNER" | "STAFF";
  }
}
