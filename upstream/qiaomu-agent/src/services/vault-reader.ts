import type { App, TFile } from "obsidian";

const MAX_NOTE_TEXT = 20_000;
const MAX_SEARCH_FILES = 2_000;

export function vaultPathFromInput(app: App, input: string): string {
  let path = input.trim();
  if (path.startsWith("obsidian://")) {
    const url = new URL(path);
    if (url.hostname !== "open") throw new Error("这个 Obsidian 链接是插件动作，不是笔记地址；请先在对应插件中打开内容并发送到 Agent");
    const vault = url.searchParams.get("vault");
    if (vault && vault !== app.vault.getName()) throw new Error("这个链接指向另一个 Obsidian 仓库");
    path = url.searchParams.get("file") ?? "";
  }
  if (path.startsWith("[[") && path.endsWith("]]")) path = path.slice(2, -2).split("|")[0]!;
  path = path.split("#")[0]!.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!path || path.startsWith("/") || path.split("/").includes("..")) throw new Error("请提供仓库内笔记路径或有效的 obsidian://open 链接");
  return path;
}

function findNote(app: App, path: string): TFile | null {
  const direct = app.vault.getAbstractFileByPath(path);
  if (direct && "extension" in direct && direct.extension === "md") return direct as TFile;
  if (!path.endsWith(".md")) {
    const withExtension = app.vault.getAbstractFileByPath(`${path}.md`);
    if (withExtension && "extension" in withExtension && withExtension.extension === "md") return withExtension as TFile;
  }
  return app.metadataCache.getFirstLinkpathDest(path, "");
}

export async function readVaultNote(app: App, input: string): Promise<{ path: string; text: string; truncated: boolean }> {
  const path = vaultPathFromInput(app, input);
  const file = findNote(app, path);
  if (!file) throw new Error(`找不到笔记：${path}`);
  const content = await app.vault.cachedRead(file);
  return { path: file.path, text: content.slice(0, MAX_NOTE_TEXT), truncated: content.length > MAX_NOTE_TEXT };
}

export async function searchVaultNotes(app: App, input: string, signal: AbortSignal): Promise<{ matches: Array<{ path: string; snippet: string }>; scanned: number; limited: boolean }> {
  const query = input.trim().toLowerCase().slice(0, 120);
  if (!query) throw new Error("请输入要搜索的文字");
  const files = app.vault.getMarkdownFiles();
  const matches: Array<{ path: string; snippet: string }> = [];
  let scanned = 0;
  for (const file of files.slice(0, MAX_SEARCH_FILES)) {
    signal.throwIfAborted();
    scanned++;
    const filenameHit = file.path.toLowerCase().includes(query);
    if (file.stat.size > 1_000_000 && !filenameHit) continue;
    const text = await app.vault.cachedRead(file);
    const pos = text.toLowerCase().indexOf(query);
    if (!filenameHit && pos < 0) continue;
    const start = Math.max(0, pos - 100);
    matches.push({ path: file.path, snippet: pos < 0 ? "" : text.slice(start, pos + query.length + 200).replace(/\s+/g, " ") });
    if (matches.length >= 8) break;
  }
  return { matches, scanned, limited: scanned < files.length };
}
