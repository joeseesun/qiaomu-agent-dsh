export type MarkdownSegment = { kind: "markdown" | "mermaid" | "pending"; text: string };

/** Only complete, top-level Mermaid fences are extracted; other code blocks stay intact. */
export function splitMermaid(text: string): MarkdownSegment[] {
  const lines = text.split("\n");
  const result: MarkdownSegment[] = [];
  let plain: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const open = /^( {0,3})(`{3,}|~{3,})([^\r]*)\r?$/.exec(lines[i]!);
    if (!open) { plain.push(lines[i]!); continue; }
    const fence = open[2]!;
    const close = new RegExp(`^ {0,3}${fence[0]}{${fence.length},}\\s*$`);
    let end = i + 1;
    while (end < lines.length && !close.test(lines[end]!)) end++;
    if (end === lines.length) {
      if (open[3]!.trim().toLowerCase() === "mermaid") {
        if (plain.length) result.push({ kind: "markdown", text: plain.join("\n") });
        plain = [];
        result.push({ kind: "pending", text: lines.slice(i + 1).join("\n") });
      } else plain.push(...lines.slice(i));
      break;
    }
    if (open[3]!.trim().toLowerCase() === "mermaid") {
      if (plain.length) result.push({ kind: "markdown", text: plain.join("\n") });
      plain = [];
      result.push({ kind: "mermaid", text: lines.slice(i + 1, end).join("\n") });
    } else plain.push(...lines.slice(i, end + 1));
    i = end;
  }
  if (plain.length) result.push({ kind: "markdown", text: plain.join("\n") });
  return result;
}
