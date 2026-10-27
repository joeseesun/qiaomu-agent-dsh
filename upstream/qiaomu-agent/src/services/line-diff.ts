export interface DiffLine { type: "same" | "add" | "del"; text: string; }

const MAX_CELLS = 4_000_000;

function lines(text: string | null): string[] {
  if (!text) return [];
  const parts = text.split("\n");
  if (parts.at(-1) === "") parts.pop();
  return parts;
}

/** Line diff: shared prefix/suffix trimmed, LCS on the middle; falls back to replace-all when huge. */
export function diffLines(before: string | null, after: string | null): DiffLine[] {
  const a = lines(before);
  const b = lines(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const head: DiffLine[] = a.slice(0, start).map((text) => ({ type: "same", text }));
  const tail: DiffLine[] = a.slice(endA).map((text) => ({ type: "same", text }));
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  let middle: DiffLine[];
  if (midA.length * midB.length > MAX_CELLS) {
    middle = [...midA.map((text) => ({ type: "del" as const, text })), ...midB.map((text) => ({ type: "add" as const, text }))];
  } else {
    const n = midA.length, m = midB.length;
    const table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
      table[i]![j] = midA[i] === midB[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
    middle = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) { middle.push({ type: "same", text: midA[i]! }); i++; j++; }
      else if (table[i + 1]![j]! >= table[i]![j + 1]!) middle.push({ type: "del", text: midA[i++]! });
      else middle.push({ type: "add", text: midB[j++]! });
    }
    while (i < n) middle.push({ type: "del", text: midA[i++]! });
    while (j < m) middle.push({ type: "add", text: midB[j++]! });
  }
  return [...head, ...middle, ...tail];
}

export function diffStats(diff: DiffLine[]): { added: number; removed: number } {
  let added = 0, removed = 0;
  for (const line of diff) { if (line.type === "add") added++; else if (line.type === "del") removed++; }
  return { added, removed };
}

/** Keeps `context` unchanged lines around each change; collapsed runs become a gap marker. */
export function hunks(diff: DiffLine[], context = 3): Array<DiffLine | { type: "gap"; count: number }> {
  const keep = new Array(diff.length).fill(false);
  diff.forEach((line, index) => {
    if (line.type === "same") return;
    for (let k = Math.max(0, index - context); k <= Math.min(diff.length - 1, index + context); k++) keep[k] = true;
  });
  const result: Array<DiffLine | { type: "gap"; count: number }> = [];
  let gap = 0;
  diff.forEach((line, index) => {
    if (keep[index]) { if (gap) { result.push({ type: "gap", count: gap }); gap = 0; } result.push(line); }
    else gap++;
  });
  if (gap && result.length) result.push({ type: "gap", count: gap });
  return result;
}

/** Reverses a unified-diff body (Codex `fileChange` update) against the new text. Null when it does not apply. */
export function reverseUnifiedDiff(after: string, diff: string): string | null {
  const target = after.split("\n");
  const hunkRe = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
  const body = diff.split("\n");
  const hunkList: Array<{ newStart: number; oldLines: string[]; newLines: string[] }> = [];
  let current: { newStart: number; oldLines: string[]; newLines: string[] } | null = null;
  for (const line of body) {
    const header = hunkRe.exec(line);
    if (header) { current = { newStart: Number(header[3]), oldLines: [], newLines: [] }; hunkList.push(current); continue; }
    if (!current || line.startsWith("\\")) continue;
    if (line.startsWith("+")) current.newLines.push(line.slice(1));
    else if (line.startsWith("-")) current.oldLines.push(line.slice(1));
    else if (line.startsWith(" ") || line === "") { current.oldLines.push(line.slice(1)); current.newLines.push(line.slice(1)); }
  }
  if (!hunkList.length) return null;
  // Apply from the bottom so earlier line numbers stay valid.
  for (const hunk of [...hunkList].reverse()) {
    // Trailing empty context lines come from the diff's final newline.
    while (hunk.newLines.length && hunk.newLines.at(-1) === "" && hunk.oldLines.at(-1) === "") { hunk.newLines.pop(); hunk.oldLines.pop(); }
    const at = Math.max(0, hunk.newStart - 1);
    const slice = target.slice(at, at + hunk.newLines.length);
    if (slice.join("\n") !== hunk.newLines.join("\n")) return null;
    target.splice(at, hunk.newLines.length, ...hunk.oldLines);
  }
  return target.join("\n");
}
