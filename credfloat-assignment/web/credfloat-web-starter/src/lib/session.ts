import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export async function requireAuth() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  return session;
}

export async function requireFirmId(): Promise<string> {
  const session = await requireAuth();
  if (!session.user.firmId) redirect("/login");
  return session.user.firmId;
}
