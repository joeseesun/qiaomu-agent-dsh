import type { Editor, EditorPosition } from "obsidian";

export interface InlineTarget {
  editor: Editor;
  path: string;
  from: EditorPosition;
  to: EditorPosition;
  original: string;
  document: string;
}

/** A preview is only applicable to the exact editor snapshot it was generated from. */
export function inlineTargetIsCurrent(target: InlineTarget, currentPath: string | null): boolean {
  return currentPath === target.path && target.editor.getValue() === target.document
    && target.editor.getRange(target.from, target.to) === target.original;
}

export function parseInlineReplacement(response: string): string {
  const match = /<replacement>([\s\S]*?)<\/replacement>/i.exec(response);
  if (!match || !match[1]?.trim()) throw new Error("没有收到可预览的改写，请重试");
  return match[1].replace(/^\n/, "").replace(/\n$/, "");
}

export interface WordChange { type: "same" | "add" | "del"; text: string }

function tokens(text: string): string[] {
  return [...new Intl.Segmenter("zh", { granularity: "word" }).segment(text)].map((item) => item.segment);
}

/** Word diff with a bounded LCS; large selections use a simple before/after preview. */
export function diffWords(before: string, after: string): WordChange[] {
  const a = tokens(before), b = tokens(after);
  if (a.length * b.length > 120_000) return [
    { type: "del", text: before }, { type: "add", text: after },
  ];
  const table = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--)
    table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
  const changes: WordChange[] = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { changes.push({ type: "same", text: a[i++]! }); j++; }
    else if (table[i + 1]![j]! >= table[i]![j + 1]!) changes.push({ type: "del", text: a[i++]! });
    else changes.push({ type: "add", text: b[j++]! });
  }
  while (i < a.length) changes.push({ type: "del", text: a[i++]! });
  while (j < b.length) changes.push({ type: "add", text: b[j++]! });
  return changes;
}
