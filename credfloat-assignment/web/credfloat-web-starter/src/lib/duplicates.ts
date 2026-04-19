/**
 * Fuzzy group debtors that likely refer to the same legal entity across
 * different client companies. Uses a normalized-name approach: strip
 * punctuation, lowercase, collapse whitespace, drop common suffixes.
 * Two names hashing to the same key are grouped together.
 *
 * Free, deterministic, no pg_trgm extension required.
 */

const SUFFIX_TOKENS = new Set([
  "pvt",
  "private",
  "ltd",
  "limited",
  "llp",
  "llc",
  "inc",
  "corp",
  "corporation",
  "co",
  "company",
  "and",
  "&",
  "enterprises",
  "enterprise",
  "traders",
  "trading",
  "industries",
  "international",
  "the",
]);

export function normalizeEntityName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((tok) => tok.length > 0 && !SUFFIX_TOKENS.has(tok))
    .join(" ")
    .trim();
}

export type DupCandidate = {
  id: string;
  tallyLedgerName: string;
  mailingName: string | null;
  closingBalance: number;
  clientCompanyId: string;
  clientCompanyName: string;
};

export type DupGroup = {
  key: string;
  displayName: string;
  totalExposure: number;
  clientCount: number;
  parties: DupCandidate[];
};

export function groupDuplicates(parties: DupCandidate[]): DupGroup[] {
  const buckets = new Map<string, DupCandidate[]>();
  for (const p of parties) {
    const name = p.mailingName || p.tallyLedgerName;
    const key = normalizeEntityName(name);
    if (!key) continue;
    const arr = buckets.get(key) ?? [];
    arr.push(p);
    buckets.set(key, arr);
  }

  const groups: DupGroup[] = [];
  for (const [key, members] of buckets.entries()) {
    const uniqueClients = new Set(members.map((m) => m.clientCompanyId));
    // We only surface cross-client duplicates — same name within one client
    // is routine and handled by the unique index on (clientCompanyId, tallyLedgerName).
    if (uniqueClients.size < 2) continue;
    groups.push({
      key,
      displayName: members[0].mailingName || members[0].tallyLedgerName,
      totalExposure: members.reduce((s, m) => s + m.closingBalance, 0),
      clientCount: uniqueClients.size,
      parties: members,
    });
  }
  return groups.sort((a, b) => b.totalExposure - a.totalExposure);
}
