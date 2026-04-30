import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Filter Supabase pooler idle-connection resets (Tokyo region, harmless —
// Prisma reconnects transparently). Keep all other DB errors visible.
const isPoolerReset = (msg: string) =>
  /ConnectionReset|forcibly closed|code: 10054/i.test(msg);

function makeClient() {
  const client = new PrismaClient({
    log: [
      { level: "error", emit: "event" },
      { level: "warn", emit: "event" },
    ],
  });

  client.$on("error", (e) => {
    if (!isPoolerReset(e.message)) console.error("[prisma:error]", e.message);
  });
  client.$on("warn", (e) => {
    if (!isPoolerReset(e.message)) console.warn("[prisma:warn]", e.message);
  });

  return client;
}

export const prisma = globalForPrisma.prisma ?? makeClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
