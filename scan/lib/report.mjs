const ORDER = ["HIGH", "MEDIUM", "LOW"];

export function formatText(result) {
  const { summary: s } = result;
  const out = [];
  out.push(`ai-app-scan  ${result.root}`);
  out.push(
    `Scanned ${s.filesScanned} files. Skipped: ${s.skippedLarge} over 1 MB, ${s.skippedBinary} binary, ${s.unreadable} unreadable.`,
  );
  out.push("");

  if (result.findings.length === 0) {
    out.push("No findings. That does not mean the app is safe: this is a heuristic scan.");
    out.push("Next: run sql/supabase-rls-audit.sql and work through CHECKLIST.md.");
  }

  for (const sev of ORDER) {
    const group = result.findings.filter((f) => f.severity === sev);
    if (group.length === 0) continue;
    out.push(`${sev} (${group.length})`);
    for (const f of group) {
      const where = f.line ? `${f.file}:${f.line}` : f.file;
      out.push(`  ${where}  [${f.rule}]`);
      out.push(`    ${f.message}`);
      if (f.evidence) out.push(`    Found: ${f.evidence}`);
      out.push(`    Fix: ${f.fix}`);
    }
    out.push("");
  }

  for (const n of result.notes) out.push(`Note: ${n}`);
  if (result.notes.length) out.push("");

  out.push(
    `Result: ${s.high} high, ${s.medium} medium, ${s.low} low. ${s.high > 0 ? "Fix the HIGH findings before launch." : "No HIGH findings."}`,
  );
  return out.join("\n") + "\n";
}

export function formatJson(result) {
  return JSON.stringify(result, null, 2) + "\n";
}
