function escape(cell: unknown): string {
  const s = cell === null || cell === undefined ? "" : String(cell);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function toCSV(
  rows: Record<string, unknown>[],
  columns: { key: string; header: string }[],
): string {
  const header = columns.map((c) => escape(c.header)).join(",");
  const body = rows
    .map((r) => columns.map((c) => escape(r[c.key])).join(","))
    .join("\r\n");
  return header + "\r\n" + body + (body ? "\r\n" : "");
}

export function downloadCSV(filename: string, csv: string) {
  const bom = "\ufeff"; // Excel-friendly UTF-8
  const blob = new Blob([bom + csv], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
