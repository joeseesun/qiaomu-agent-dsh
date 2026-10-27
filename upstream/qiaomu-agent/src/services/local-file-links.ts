import { Platform, type App } from "obsidian";
import { getRuntimeRequire } from "./runtime-require";
import { artifactText as t } from "../i18n/artifacts";

interface FileTarget { path: string; base?: string }

function decodePath(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}

/** Local artifacts must never go through openLinkText, which may create a note. */
export function localFileTarget(app: App, raw: string, sourcePath = ""): FileTarget | null {
  const adapter = app.vault.adapter;
  const base = "getBasePath" in adapter && typeof adapter.getBasePath === "function" ? String(adapter.getBasePath()) : undefined;
  if (/^file:/i.test(raw)) {
    try {
      const url = new URL(raw);
      let path = decodePath(url.pathname);
      if (/^\/[a-z]:\//i.test(path)) path = path.slice(1);
      if (url.hostname && url.hostname !== "localhost") path = `//${url.hostname}${path}`;
      return { path };
    } catch { return { path: "" }; }
  }
  if (/^app:\/\//i.test(raw)) {
    const resource = decodePath(raw.split("?")[0] ?? raw);
    const file = app.vault.getFiles().find((file) => decodePath(adapter.getResourcePath(file.path).split("?")[0] ?? "") === resource);
    return file && base ? { path: file.path, base } : null;
  }
  const path = decodePath(raw);
  if (/^(\/|~\/|[a-z]:[\\/])/i.test(path)) return { path };
  if (/^[a-z][a-z\d+.-]*:/i.test(path) || path.startsWith("#")) return null;
  const linkpath = decodePath(raw.split("#")[0] ?? raw);
  if (!/\.[a-z][a-z\d]{0,9}$/i.test(linkpath) || /\.(md|canvas|base)$/i.test(linkpath)) return null;
  const file = app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
  const folder = sourcePath.includes("/") ? sourcePath.slice(0, sourcePath.lastIndexOf("/")) : "";
  return { path: file?.path ?? `${folder ? `${folder}/` : ""}${linkpath}`, base };
}

interface DesktopShell { openPath(path: string): Promise<string>; showItemInFolder(path: string): void }

export async function openLocalFile(app: App, raw: string, sourcePath = "", reveal = false): Promise<void> {
  if (!Platform.isDesktopApp) throw new Error(t("desktop"));
  const target = localFileTarget(app, raw, sourcePath);
  if (!target?.path) throw new Error(t("invalid"));
  const load = getRuntimeRequire();
  if (!load) throw new Error(t("unavailable"));
  const path = load("path") as typeof import("node:path");
  const fs = (load("fs") as typeof import("node:fs")).promises;
  const home = (load("os") as typeof import("node:os")).homedir();
  const requested = target.path.startsWith("~/") ? path.join(home, target.path.slice(2)) : target.path;
  if (!path.isAbsolute(requested) && !target.base) throw new Error(t("location"));
  const absolute = path.resolve(target.base ?? "", requested);
  try { await fs.stat(absolute); } catch { throw new Error(t("missing", { path: absolute })); }
  const electron = load("electron") as { shell?: DesktopShell; remote?: { shell?: DesktopShell } };
  const shell = electron.shell ?? electron.remote?.shell;
  if (!shell) throw new Error(t("unavailable"));
  if (reveal) shell.showItemInFolder(absolute);
  else {
    const error = await shell.openPath(absolute);
    if (error) throw new Error(t("failed", { reason: error }));
  }
}
