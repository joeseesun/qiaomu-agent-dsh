import { Events, TFile, TFolder } from "./original-ui";
import { noteMetadata } from "../metadata.js";
import { parseDocument, Document, isMap } from "yaml";
const visible = (path: string) =>
  !path.startsWith("Config/") &&
  !path.startsWith("Cache/") &&
  path !== "Config" &&
  path !== "Cache";
/** Stable file identities and optimistic writes translate the original vault calls into scoped Host operations. */
export class HomeVault extends Events {
  configDir = "Config";
  files = new Map<string, TFile | TFolder>();
  metadataCache: any;
  adapter: any;
  root = "";
  private epochs = new Map<string, number>();
  private lanes = new Map<string, Promise<any>>();
  private blobs = new Map<string, string>();
  private resources = new Map<string, Promise<void>>();
  private disposed = false;
  private syncId = 0;
  constructor(
    private operation: (request: any) => Promise<any>,
    private assetChanged: () => void = () => {},
  ) {
    super();
    this.files.set("", new TFolder(""));
    this.metadataCache = Object.assign(new Events(), {
      getFileCache: (file: TFile) => (file as any).metadata ?? null,
      resolvedLinks: {},
      unresolvedLinks: {},
      getFirstLinkpathDest: (link: string, source: string) =>
        this.resolveLink(link, source),
    });
    this.adapter = {
      exists: async (path: string) =>
        (await this.operation({ action: "exists", path })).exists,
      read: async (path: string) => (await this.readPath(path)).text,
      write: (path: string, text: string) => this.upsert(path, text),
      mkdir: (path: string) => this.createFolder(path),
      writeBinary: (path: string, bytes: ArrayBuffer) =>
        this.upsert(path, bytes),
      getResourcePath: (path: string) => this.resource(path),
      list: async (path: string) => {
        const snapshot = await this.operation({ action: "snapshot" });
        const folder = path.replace(/\/$/, "");
        const children = snapshot.entries.filter(
          (entry: any) =>
            entry.path.slice(0, entry.path.lastIndexOf("/")) === folder,
        );
        return {
          files: children
            .filter((x: any) => !x.directory)
            .map((x: any) => x.path),
          folders: children
            .filter((x: any) => x.directory)
            .map((x: any) => x.path),
        };
      },
      stat: async (path: string) => {
        const snapshot = await this.operation({ action: "snapshot" });
        const entry = snapshot.entries.find((x: any) => x.path === path);
        return entry
          ? { ...entry.stat, type: entry.directory ? "folder" : "file" }
          : null;
      },
      remove: async (path: string) => {
        await this.operation({ action: "remove-cache", path });
        this.revoke(path);
      },
    };
  }
  private ensureFolder(path: string): TFolder {
    let folder = this.files.get(path);
    if (folder instanceof TFolder) return folder;
    folder = new TFolder(path);
    this.files.set(path, folder);
    if (path) {
      const parent = this.ensureFolder(
        path.slice(0, Math.max(0, path.lastIndexOf("/"))),
      );
      folder.parent = parent;
      if (!parent.children.includes(folder)) parent.children.push(folder);
    }
    return folder;
  }
  private upsertEntry(entry: any) {
    let file = this.files.get(entry.path);
    if (entry.directory) {
      const folder = this.ensureFolder(entry.path);
      return folder;
    }
    if (!(file instanceof TFile)) {
      file = new TFile(entry.path, entry.stat);
      this.files.set(file.path, file);
      const parent = this.ensureFolder(
        file.path.includes("/")
          ? file.path.slice(0, file.path.lastIndexOf("/"))
          : "",
      );
      file.parent = parent;
      parent.children.push(file);
    }
    file.stat = entry.stat;
    if (entry.metadata) (file as any).metadata = entry.metadata;
    return file;
  }
  async sync() {
    const id = ++this.syncId;
    const before = new Map(this.epochs);
    const snapshot = await this.operation({ action: "snapshot" });
    if (this.disposed || id !== this.syncId) return;
    this.root = snapshot.root;
    const present = new Set([""]);
    for (const entry of snapshot.entries) {
      present.add(entry.path);
      if ((before.get(entry.path) || 0) !== (this.epochs.get(entry.path) || 0))
        continue;
      const old = this.files.get(entry.path);
      const mtime = old instanceof TFile ? old.stat.mtime : null;
      const file = this.upsertEntry(entry);
      if (!old) this.trigger("create", file);
      else if (file instanceof TFile && mtime !== file.stat.mtime) {
        this.revoke(file.path);
        this.trigger("modify", file);
      }
    }
    for (const [path, file] of [...this.files])
      if (
        !present.has(path) &&
        (before.get(path) || 0) === (this.epochs.get(path) || 0)
      ) {
        this.files.delete(path);
        if (file.parent)
          file.parent.children = file.parent.children.filter(
            (child) => child !== file,
          );
        this.revoke(path);
        this.trigger("delete", file);
      }
    this.reindexLinks();
    this.metadataCache.trigger("resolved");
  }
  getName() {
    return this.root.split(/[\\/]/).at(-1) || "Home";
  }
  getRoot() {
    return this.files.get("") as TFolder;
  }
  getAbstractFileByPath(path: string) {
    return this.files.get(path === "/" ? "" : path) || null;
  }
  getFileByPath(path: string) {
    const file = this.getAbstractFileByPath(path);
    return file instanceof TFile ? file : null;
  }
  getMarkdownFiles() {
    return this.getFiles().filter((file) => file.extension === "md");
  }
  getFiles() {
    return [...this.files.values()].filter(
      (file): file is TFile => file instanceof TFile && visible(file.path),
    );
  }
  getAllLoadedFiles() {
    return [...this.files.values()].filter((file) => visible(file.path));
  }
  async readPath(path: string) {
    if (this.disposed) throw Error("Home workspace has closed");
    return this.operation({ action: "read", path });
  }
  async read(file: TFile) {
    return (await this.readPath(file.path)).text;
  }
  cachedRead(file: TFile) {
    return this.read(file);
  }
  private serialize(path: string, run: () => Promise<any>) {
    const task = (this.lanes.get(path) || Promise.resolve())
      .catch(() => {})
      .then(() => {
        if (this.disposed) throw Error("Home workspace has closed");
        return run();
      });
    this.lanes.set(path, task);
    void task
      .finally(() => {
        if (this.lanes.get(path) === task) this.lanes.delete(path);
      })
      .catch(() => {});
    return task;
  }
  private async save(
    path: string,
    content: string | ArrayBuffer,
    etag: string | null,
  ) {
    const binary = typeof content !== "string";
    let base64: string | undefined;
    if (binary) {
      const bytes = new Uint8Array(content);
      let value = "";
      for (let offset = 0; offset < bytes.length; offset += 32768)
        value += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
      base64 = btoa(value);
    }
    const result = await this.operation({
      action: "write",
      path,
      etag,
      ...(binary ? { base64 } : { text: content }),
    });
    if (this.disposed) return new TFile(path, result.stat);
    this.epochs.set(path, (this.epochs.get(path) || 0) + 1);
    const existed = this.files.has(path);
    const file = this.upsertEntry({
      ...result,
      ...(!binary && path.endsWith(".md")
        ? { metadata: noteMetadata(content) }
        : {}),
    });
    this.revoke(path);
    this.reindexLinks();
    this.trigger(existed ? "modify" : "create", file);
    this.metadataCache.trigger("changed", file);
    return file;
  }
  create(path: string, text: string) {
    return this.serialize(path, () => this.save(path, text, null));
  }
  /** A displayed draft may only replace the exact note it was based on. */
  replaceSnapshot(path: string, before: string | null, text: string) {
    return this.serialize(path, async () => {
      const exists = await this.adapter.exists(path);
      const current = exists ? await this.readPath(path) : null;
      if ((current?.text ?? null) !== before)
        throw Error(
          "笔记已在其他位置修改。草稿已保留，请先打开笔记核对。 / Note changed elsewhere. Your draft is retained; open the note to compare.",
        );
      return this.save(path, text, current?.etag ?? null);
    });
  }
  createBinary(path: string, bytes: ArrayBuffer) {
    return this.serialize(path, () => this.save(path, bytes, null));
  }
  modify(file: TFile, text: string) {
    return this.serialize(file.path, async () => {
      const before = await this.readPath(file.path);
      return this.save(file.path, text, before.etag);
    });
  }
  process(file: TFile, transform: (text: string) => string) {
    return this.serialize(file.path, async () => {
      const before = await this.readPath(file.path);
      const next = transform(before.text);
      if (typeof next !== "string")
        throw Error("A note transform must return text");
      if (next !== before.text) await this.save(file.path, next, before.etag);
      return next;
    });
  }
  private upsert(path: string, content: string | ArrayBuffer) {
    return this.serialize(path, async () => {
      const exists = await this.adapter.exists(path);
      const before = exists
        ? await this.operation({
            action: "read",
            path,
            binary: typeof content !== "string",
          })
        : null;
      return this.save(path, content, before?.etag ?? null);
    });
  }
  async createFolder(path: string) {
    await this.operation({ action: "mkdir", path });
    this.epochs.set(path, (this.epochs.get(path) || 0) + 1);
    const folder = this.ensureFolder(path);
    this.trigger("create", folder);
    return folder;
  }
  async processFrontMatter(
    file: TFile,
    change: (value: Record<string, any>) => void,
  ) {
    return this.process(file, (text) => {
      const match =
        /^\uFEFF?---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)(?:\r?\n|$)/.exec(text);
      if (!match && /^\uFEFF?---(?:\r?\n|$)/.test(text))
        throw Error("The note has incomplete frontmatter");
      const doc = match ? parseDocument(match[1]!) : new Document({});
      if (doc.errors.length || (doc.contents && !isMap(doc.contents)))
        throw Error("The note has invalid frontmatter");
      const current = doc.toJS({ maxAliasCount: 20 }) || {};
      const next = structuredClone(current);
      change(next);
      for (const key of Object.keys(current))
        if (!Object.hasOwn(next, key)) doc.delete(key);
      for (const [key, value] of Object.entries(next))
        if (JSON.stringify(current[key]) !== JSON.stringify(value))
          doc.set(key, value);
      if (JSON.stringify(current) === JSON.stringify(next)) return text;
      const newline = text.includes("\r\n") ? "\r\n" : "\n";
      const header = doc.toString({ lineWidth: 0 }).replace(/\r?\n/g, newline);
      return (
        (text.startsWith("\uFEFF") ? "\uFEFF" : "") +
        "---" +
        newline +
        header +
        "---" +
        newline +
        (match ? text.slice(match[0].length) : text.replace(/^\uFEFF/, ""))
      );
    });
  }
  getResourcePath(file: TFile) {
    return this.resource(file.path);
  }
  private resource(path: string) {
    const epoch = this.epochs.get(path) || 0;
    if (this.blobs.has(path)) return this.blobs.get(path)!;
    if (!this.disposed && !this.resources.has(path)) {
      const request = this.operation({ action: "read", path, binary: true })
        .then((result: any) => {
          if (this.disposed || epoch !== (this.epochs.get(path) || 0)) return;
          const type = (
            {
              png: "image/png",
              jpg: "image/jpeg",
              jpeg: "image/jpeg",
              webp: "image/webp",
              gif: "image/gif",
              avif: "image/avif",
              bmp: "image/bmp",
            } as any
          )[path.split(".").at(-1)!.toLowerCase()];
          if (!type) throw Error("Unsupported wallpaper type");
          const bytes = Uint8Array.from(atob(result.base64), (char) =>
            char.charCodeAt(0),
          );
          this.blobs.set(
            path,
            URL.createObjectURL(new Blob([bytes], { type })),
          );
          this.assetChanged();
        })
        .catch(() => {})
        .finally(() => this.resources.delete(path));
      this.resources.set(path, request);
    }
    return "";
  }
  private revoke(path: string) {
    const url = this.blobs.get(path);
    if (url) URL.revokeObjectURL(url);
    this.blobs.delete(path);
  }
  resolveLink(link: string, source = "") {
    let clean = link.split("#")[0] ?? "";
    try {
      clean = decodeURIComponent(clean);
    } catch {}
    if (!clean) return this.getFileByPath(source);
    const candidates = [clean, clean + ".md"];
    const folder = source.includes("/")
      ? source.slice(0, source.lastIndexOf("/") + 1)
      : "";
    for (const value of [
      ...candidates.map((value) => folder + value),
      ...candidates,
    ]) {
      const file = this.getFileByPath(value);
      if (file) return file;
    }
    return this.getFiles().find((file) => file.basename === clean) || null;
  }
  private reindexLinks() {
    const resolved: Record<string, Record<string, number>> = {},
      unresolved: Record<string, Record<string, number>> = {};
    for (const file of this.getMarkdownFiles()) {
      resolved[file.path] = {};
      unresolved[file.path] = {};
      for (const { link } of (file as any).metadata?.links || []) {
        if (/^[a-z]+:/i.test(link)) continue;
        const target = this.resolveLink(link, file.path);
        const index = target ? resolved[file.path] : unresolved[file.path],
          key = target?.path || link;
        index![key] = (index![key] || 0) + 1;
      }
    }
    this.metadataCache.resolvedLinks = resolved;
    this.metadataCache.unresolvedLinks = unresolved;
  }
  dispose() {
    this.disposed = true;
    this.syncId++;
    this.clear();
    this.metadataCache.clear();
    for (const path of this.blobs.keys()) this.revoke(path);
  }
}
