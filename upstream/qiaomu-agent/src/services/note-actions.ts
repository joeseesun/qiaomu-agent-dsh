import { type App, TFile } from "obsidian";

export interface AppendReceipt { path: string; suffix: string; prefix: string; }
export function appendedText(existing: string, text: string): string {
  return `${existing}${existing.endsWith("\n\n") || !existing ? "" : existing.endsWith("\n") ? "\n" : "\n\n"}${text.trim()}\n`;
}
export function undoAppend(current: string, receipt: AppendReceipt): string {
  const expected = receipt.prefix + receipt.suffix;
  if (!current.startsWith(expected)) throw new Error("文件的追加位置已被编辑，无法安全撤销；请手动处理");
  return receipt.prefix + current.slice(expected.length);
}
/** Vault.process serializes a read-modify-write, avoiding stale snapshot overwrites. */
export async function appendReply(app: App, path: string, text: string): Promise<AppendReceipt> {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile) || file.extension !== "md") throw new Error("目标笔记不存在或不是 Markdown 文件");
  let receipt: AppendReceipt | undefined;
  await app.vault.process(file, (current) => {
    const next = appendedText(current, text);
    receipt = { path, prefix: current, suffix: next.slice(current.length) };
    return next;
  });
  return receipt!;
}
export async function undoReply(app: App, receipt: AppendReceipt): Promise<void> {
  const file = app.vault.getAbstractFileByPath(receipt.path);
  if (!(file instanceof TFile)) throw new Error("目标文件已被移动或删除");
  await app.vault.process(file, (current) => undoAppend(current, receipt));
}
