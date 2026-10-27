import * as obsidian from "obsidian";

const zh = {
  open: "打开文件", finder: "在 Finder 中显示", reveal: "在文件管理器中显示",
  desktop: "请在桌面端打开本地文件", invalid: "本地文件地址不可用", unavailable: "当前环境无法打开本地文件",
  location: "无法确定本地文件的位置", missing: "文件不存在或无法访问：{path}", failed: "无法打开文件：{reason}",
} as const;
const en: Record<keyof typeof zh, string> = {
  open: "Open file", finder: "Show in Finder", reveal: "Show in file manager",
  desktop: "Open local files on desktop", invalid: "Local file address is unavailable", unavailable: "Cannot open local files in this environment",
  location: "Cannot determine the local file location", missing: "File does not exist or cannot be accessed: {path}", failed: "Cannot open file: {reason}",
};

export function artifactText(key: keyof typeof zh, params: { path?: string; reason?: string } = {}): string {
  const language = typeof obsidian.getLanguage === "function" ? obsidian.getLanguage() : "zh";
  return (language.startsWith("en") ? en : zh)[key].replace(/\{(path|reason)\}/g, (_, name: "path" | "reason") => params[name] ?? "");
}
