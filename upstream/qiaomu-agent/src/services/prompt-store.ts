import { normalizePath, parseYaml, TFile, type App, type Plugin } from "obsidian";
import { parsePromptFile, promptFileName, serializePrompt, type PromptItem } from "./prompt-library";

/**
 * The user's prompts as Markdown files in one vault folder (default `Qiaomu Agent/Prompts`), so they sync
 * with the vault and can be edited like any note. The folder is created with the first saved prompt.
 */
export class PromptStore {
  prompts: PromptItem[] = [];
  private readonly listeners = new Set<() => void>();
  private reloadTimer: number | null = null;
  private loading: Promise<void> | null = null;

  constructor(private readonly app: App, private readonly folder: () => string) {}

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private inFolder(path: string): boolean {
    const folder = this.folder();
    return path.startsWith(`${folder}/`) && path.toLowerCase().endsWith(".md");
  }

  /** Re-reads the folder when a prompt file is added, edited, moved or removed, in Obsidian or by sync. */
  watch(plugin: Plugin): void {
    const touched = (path: string, oldPath?: string) => { if (this.inFolder(path) || (oldPath && this.inFolder(oldPath))) this.scheduleReload(); };
    plugin.registerEvent(this.app.vault.on("create", (file) => touched(file.path)));
    plugin.registerEvent(this.app.vault.on("modify", (file) => touched(file.path)));
    plugin.registerEvent(this.app.vault.on("delete", (file) => touched(file.path)));
    plugin.registerEvent(this.app.vault.on("rename", (file, oldPath) => touched(file.path, oldPath)));
    plugin.register(() => { if (this.reloadTimer !== null) window.clearTimeout(this.reloadTimer); });
  }

  private scheduleReload(): void {
    if (this.reloadTimer !== null) window.clearTimeout(this.reloadTimer);
    this.reloadTimer = window.setTimeout(() => { this.reloadTimer = null; void this.load(); }, 150);
  }

  load(): Promise<void> {
    this.loading ??= (async () => {
      try {
        const files = this.app.vault.getMarkdownFiles().filter((file) => this.inFolder(file.path)).sort((a, b) => a.path.localeCompare(b.path));
        const items = await Promise.all(files.map(async (file) => parsePromptFile(await this.app.vault.cachedRead(file), file.path, parseYaml)));
        this.prompts = items.filter((item): item is PromptItem => item !== null);
      } finally { this.loading = null; }
      for (const listener of this.listeners) listener();
    })();
    return this.loading;
  }

  file(item: PromptItem): TFile | null {
    const file = item.path ? this.app.vault.getAbstractFileByPath(item.path) : null;
    return file instanceof TFile ? file : null;
  }

  private async ensureFolder(): Promise<void> {
    let path = "";
    for (const part of this.folder().split("/")) {
      path = path ? `${path}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(path)) await this.app.vault.createFolder(path);
    }
  }

  private freePath(title: string, except?: string): string {
    const base = normalizePath(`${this.folder()}/${promptFileName(title)}`);
    for (let n = 1; ; n++) {
      const path = n === 1 ? `${base}.md` : `${base} ${n}.md`;
      if (path === except || !this.app.vault.getAbstractFileByPath(path)) return path;
    }
  }

  /** Writes the prompt to its file, renaming it when the title changed; returns the saved prompt. */
  async save(item: PromptItem): Promise<PromptItem> {
    const content = serializePrompt(item);
    let file = this.file(item);
    if (file) {
      await this.app.vault.modify(file, content);
      const wanted = this.freePath(item.title, file.path);
      if (wanted !== file.path) await this.app.fileManager.renameFile(file, wanted);
    } else {
      await this.ensureFolder();
      file = await this.app.vault.create(this.freePath(item.title), content);
    }
    const saved = { ...item, source: "user" as const, path: file.path };
    this.prompts = [...this.prompts.filter((p) => p.path !== item.path && p.path !== file.path), saved];
    for (const listener of this.listeners) listener();
    return saved;
  }

  /** Moves the file to the trash the user chose in Obsidian's settings. */
  async remove(item: PromptItem): Promise<void> {
    const file = this.file(item);
    if (file) await this.app.fileManager.trashFile(file);
    this.prompts = this.prompts.filter((p) => p.path !== item.path);
    for (const listener of this.listeners) listener();
  }
}
