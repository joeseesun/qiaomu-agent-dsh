import { normalizePath, TFile, type App, type EventRef, type TAbstractFile } from "obsidian";
import type { FileChange } from "../types";
import { reverseUnifiedDiff } from "./line-diff";

/** Text we diff and can restore; anything else is listed only. */
const TEXT_EXTENSIONS = new Set(["md", "txt", "canvas", "base", "json", "css", "js", "ts", "tsx", "jsx", "html", "csv", "yml", "yaml", "xml", "svg", "toml", "ini", "sh", "py", "tex", "bib"]);
export const MAX_TRACKED_BYTES = 512 * 1024;
/** Plugin-owned output (generated images) is never reported as an agent change. */
const IGNORED_PREFIXES = [".qiaomu-agent/", ".trash/"];

/** Files outside the vault, reached through Node on desktop. `read` gives null for a missing file. */
export interface ExternalFiles {
  read(path: string): Promise<string | null>;
  write(path: string, content: string): Promise<void>;
  trash(path: string): Promise<void>;
}

export function isTextPath(path: string): boolean {
  return TEXT_EXTENSIONS.has(path.split(".").pop()?.toLowerCase() ?? "");
}

/** Absolute or vault-relative path → vault-relative, or null when outside the vault. */
export function toVaultPath(path: string, vaultRoot: string | null): string | null {
  const unified = path.replace(/\\/g, "/");
  if (!vaultRoot) return unified.startsWith("/") ? null : normalizePath(unified);
  const root = vaultRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  if (unified === root) return null;
  if (unified.startsWith(`${root}/`)) return normalizePath(unified.slice(root.length + 1));
  if (/^([a-zA-Z]:)?\//.test(unified)) return null;
  const relative = normalizePath(unified);
  return relative.split("/").includes("..") ? null : relative;
}

/**
 * Collects what one agent turn changed. Before-content comes from (in order) what the agent
 * reported, a read taken when the agent announced the write, or a snapshot taken before the turn.
 * Vault events catch writes the agent did not announce; those are listed but not restorable.
 */
export class TurnChangeTracker {
  private readonly before = new Map<string, string | null>();
  private readonly touched = new Set<string>();
  private readonly outside = new Set<string>();
  /** Outside-the-vault files whose before-content the writer handed us; these can be restored. */
  private readonly outsideBefore = new Map<string, string | null>();
  /** Unified diffs reported with the write (Codex), used when our read landed after the write. */
  private readonly patches = new Map<string, string[]>();
  /** Paths whose before-content came from our own read; an agent-reported value is more exact. */
  private readonly fromRead = new Set<string>();
  private readonly pending: Promise<void>[] = [];
  private readonly refs: EventRef[] = [];

  constructor(private readonly app: App, private readonly vaultRoot: string | null, snapshots: Map<string, string> = new Map(), private readonly external: ExternalFiles | null = null) {
    for (const [path, content] of snapshots) this.snapshots.set(path, content);
  }
  private readonly snapshots = new Map<string, string>();

  start(): void {
    const vault = this.app.vault;
    const touch = (file: TAbstractFile) => { if (file instanceof TFile) this.touch(file.path); };
    this.refs.push(vault.on("modify", touch), vault.on("create", touch), vault.on("delete", touch));
    this.refs.push(vault.on("rename", (file, oldPath) => { touch(file); this.touch(oldPath); }));
  }

  private touch(path: string): void {
    if (IGNORED_PREFIXES.some((prefix) => path.startsWith(prefix))) return;
    this.touched.add(path);
  }

  /** The agent read `path`: keep that content as a candidate before-state without marking it changed. */
  observe(path: string): void {
    const relative = toVaultPath(path, this.vaultRoot);
    if (relative === null || this.snapshots.has(relative) || this.before.has(relative) || this.touched.has(relative) || !isTextPath(relative)) return;
    this.pending.push(this.read(relative).then((content) => {
      // A write that raced this read must not turn its own result into the before-state.
      if (content !== null && !this.touched.has(relative) && !this.snapshots.has(relative)) this.snapshots.set(relative, content);
    }, () => undefined));
  }

  /** The agent is about to write `path`; record its current content unless already known. */
  intent(path: string, knownBefore?: string | null, patch?: string): void {
    const relative = toVaultPath(path, this.vaultRoot);
    if (relative === null) {
      if (knownBefore !== undefined && this.external) { if (!this.outsideBefore.has(path)) this.outsideBefore.set(path, knownBefore); }
      else if (!this.outsideBefore.has(path)) this.outside.add(path);
      return;
    }
    if (IGNORED_PREFIXES.some((prefix) => relative.startsWith(prefix))) return;
    this.touched.add(relative);
    if (patch) this.patches.set(relative, [...(this.patches.get(relative) ?? []), patch]);
    if (knownBefore !== undefined && (!this.before.has(relative) || this.fromRead.has(relative))) {
      this.fromRead.delete(relative);
      this.before.set(relative, knownBefore);
      return;
    }
    if (this.before.has(relative)) return;
    if (this.snapshots.has(relative)) { this.before.set(relative, this.snapshots.get(relative)!); return; }
    if (!isTextPath(relative)) return;
    // Claim the slot synchronously so a later intent cannot race this read.
    this.before.set(relative, null);
    this.fromRead.add(relative);
    // A failed read (too large, unreadable) leaves the file untracked rather than "did not exist".
    this.pending.push(this.read(relative).then(
      (content) => { if (this.fromRead.has(relative)) this.before.set(relative, content); },
      () => { if (this.fromRead.has(relative)) { this.before.delete(relative); this.fromRead.delete(relative); } },
    ));
  }

  private async read(path: string): Promise<string | null> {
    const adapter = this.app.vault.adapter;
    if (!await adapter.exists(path)) return null;
    const stat = await adapter.stat(path);
    if (stat && stat.size > MAX_TRACKED_BYTES) throw new Error("too large");
    return adapter.read(path);
  }

  /** Obsidian's file watcher reports external writes shortly after they land; let it settle. */
  static settleMs = 700;

  async finish(): Promise<FileChange[]> {
    if (TurnChangeTracker.settleMs > 0) await new Promise((resolve) => window.setTimeout(resolve, TurnChangeTracker.settleMs));
    for (const ref of this.refs.splice(0)) this.app.vault.offref(ref);
    await Promise.allSettled(this.pending);
    const changes: FileChange[] = [];
    for (const path of [...this.touched].sort()) {
      if (!isTextPath(path)) {
        changes.push({ path, before: null, after: null, tracked: false, binary: true });
        continue;
      }
      let after: string | null;
      try { after = await this.read(path); } catch { changes.push({ path, before: null, after: null, tracked: false, binary: true }); continue; }
      const known = this.before.has(path) || this.snapshots.has(path);
      let before = this.before.has(path) ? this.before.get(path)! : this.snapshots.get(path) ?? null;
      const patches = this.patches.get(path);
      if (known && before === after && after !== null && patches?.length) {
        // Our read raced the write; undo the reported patches instead.
        let restored: string | null = after;
        for (const patch of [...patches].reverse()) restored = restored === null ? null : reverseUnifiedDiff(restored, patch);
        if (restored === null) { changes.push({ path, before: null, after, tracked: false }); continue; }
        before = restored;
      }
      if (known && before === after) continue;
      changes.push({ path, before: known ? before : null, after, tracked: known });
    }
    for (const [path, before] of [...this.outsideBefore].sort(([a], [b]) => a.localeCompare(b))) {
      let after: string | null;
      try { after = await this.external!.read(path); } catch { changes.push({ path, before: null, after: null, tracked: false, outside: true }); continue; }
      if (before !== after) changes.push({ path, before, after, tracked: true, outside: true });
    }
    for (const path of [...this.outside].sort()) if (!this.outsideBefore.has(path)) changes.push({ path, before: null, after: null, tracked: false, outside: true });
    return changes;
  }

  dispose(): void {
    for (const ref of this.refs.splice(0)) this.app.vault.offref(ref);
  }
}

export type RollbackClass = "safe" | "conflict" | "untracked";

export interface RollbackItem { change: FileChange; kind: RollbackClass; }

/** Classifies each change: safe (still exactly what the agent left), conflict (edited since), untracked. */
export async function planRollback(app: App, changes: FileChange[], external: ExternalFiles | null = null): Promise<RollbackItem[]> {
  const items: RollbackItem[] = [];
  for (const change of changes) {
    if (change.reverted) continue;
    if (!change.tracked || change.binary || (change.outside && !external)) { items.push({ change, kind: "untracked" }); continue; }
    let current: string | null;
    if (change.outside) {
      try { current = await external!.read(change.path); } catch { items.push({ change, kind: "untracked" }); continue; }
    } else current = await app.vault.adapter.exists(change.path) ? await app.vault.adapter.read(change.path) : null;
    // Already back to its before-state (restored earlier, or undone by hand): nothing to do.
    if (current === change.before) continue;
    items.push({ change, kind: current === change.after ? "safe" : "conflict" });
  }
  return items;
}

async function ensureFolder(app: App, path: string): Promise<void> {
  const folder = path.split("/").slice(0, -1).join("/");
  if (!folder || await app.vault.adapter.exists(folder)) return;
  await app.vault.createFolder(folder).catch(async () => { await app.vault.adapter.mkdir(folder); });
}

/** Restores the before-state of the given changes. Deleting a created file goes to the trash. */
export async function applyRollback(app: App, changes: FileChange[], external: ExternalFiles | null = null): Promise<{ restored: string[]; failed: Array<{ path: string; error: string }> }> {
  const restored: string[] = [];
  const failed: Array<{ path: string; error: string }> = [];
  for (const change of changes) {
    try {
      if (change.outside) {
        if (!external) throw new Error("此设备无法访问库外文件");
        if (change.before === null) { if (await external.read(change.path).catch(() => "") !== null) await external.trash(change.path); }
        else await external.write(change.path, change.before);
        restored.push(change.path);
        continue;
      }
      const file = app.vault.getAbstractFileByPath(change.path);
      if (change.before === null) {
        if (file instanceof TFile) await app.fileManager.trashFile(file);
        else if (await app.vault.adapter.exists(change.path)) await app.vault.adapter.remove(change.path);
      } else if (file instanceof TFile) {
        await app.vault.modify(file, change.before);
      } else if (await app.vault.adapter.exists(change.path)) {
        await app.vault.adapter.write(change.path, change.before);
      } else {
        await ensureFolder(app, change.path);
        await app.vault.create(change.path, change.before);
      }
      restored.push(change.path);
    } catch (error) {
      failed.push({ path: change.path, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { restored, failed };
}
