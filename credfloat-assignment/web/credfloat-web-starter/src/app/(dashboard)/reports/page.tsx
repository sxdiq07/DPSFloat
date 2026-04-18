export default function ReportsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
        <p className="text-sm text-muted-foreground">
          Collection trends, per-client performance, staff activity
        </p>
      </div>
      <div className="rounded-lg border bg-card p-12 text-center">
        <div className="text-sm text-muted-foreground">
          Reports coming in V1.1 — ask Claude Code to build this page using
          Recharts once enough sync data is accumulated.
        </div>
      </div>
    </div>
  );
}
