import { prisma } from "@/lib/prisma";
import { requireFirmId } from "@/lib/session";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { ReminderForm } from "./_components/reminder-form";

export const dynamic = "force-dynamic";

export default async function ReminderConfigPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const firmId = await requireFirmId();
  const { id } = await params;

  const client = await prisma.clientCompany.findFirst({
    where: { id, firmId },
    include: {
      reminderRules: { orderBy: { createdAt: "asc" }, take: 1 },
    },
  });

  if (!client) notFound();

  const rule = client.reminderRules[0];

  return (
    <div className="space-y-10">
      <PageHeader
        crumbs={[
          { label: "Clients", href: "/clients" },
          { label: client.displayName, href: `/clients/${client.id}` },
          { label: "Reminders" },
        ]}
        eyebrow="Reminder configuration"
        title="How Ledger reminds this client's debtors"
        subtitle="Pick the trigger days, channels, and templates. Changes apply to tomorrow's cron run."
      />

      <ReminderForm
        clientId={client.id}
        clientName={client.displayName}
        initial={{
          enabled: rule?.enabled ?? true,
          triggerDays: rule?.triggerDays ?? [-3, 0, 7, 14, 30],
          channels: (rule?.channels ?? ["EMAIL"]) as ("EMAIL" | "SMS" | "WHATSAPP")[],
          emailTemplate: rule?.emailTemplate ?? "",
          smsTemplate: rule?.smsTemplate ?? "",
          whatsappTemplateId: rule?.whatsappTemplateId ?? "",
        }}
      />
    </div>
  );
}
