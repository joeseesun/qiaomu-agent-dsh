import {
  mkdir,
  realpath,
  lstat,
  readdir,
  readFile,
  writeFile,
  rename,
  unlink,
  link,
  open,
} from "node:fs/promises";
import path from "node:path";
import { constants } from "node:fs";
import { noteMetadata } from "../metadata.js";
import { createHash, randomUUID } from "node:crypto";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const MAX_TEXT = 2 * 1024 * 1024,
  MAX_BINARY = 16 * 1024 * 1024,
  MAX_FILES = 5000;
const EXTENSIONS = new Set([
  "md",
  "json",
  "txt",
  "canvas",
  "base",
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "avif",
  "bmp",
  "svg",
  "mp3",
  "wav",
  "m4a",
  "ogg",
  "mp4",
  "epub",
]);
const relative = (value) =>
  typeof value === "string" &&
  !value.includes("\0") &&
  !value.includes("\\") &&
  !path.isAbsolute(value) &&
  value.length <= 1024 &&
  !value
    .split("/")
    .some((part) => part === ".." || part === "." || part.startsWith("."));
const safeName = (value) =>
  relative(value) &&
  value &&
  !value.endsWith("/") &&
  EXTENSIONS.has(value.split(".").at(-1).toLowerCase());
/** The configured Home workspace is the only filesystem authority. No vault-wide scan or hidden files. */
export class HomeWorkspace {
  constructor(root) {
    this.root = path.resolve(root);
    this.lane = Promise.resolve();
    this.ready = mkdir(this.root, { recursive: true, mode: 0o700 })
      .then(() => realpath(this.root))
      .then((root) => (this.root = root));
  }
  async resolve(value, { directory = false } = {}) {
    await this.ready;
    if (!relative(value) || (!directory && !safeName(value)))
      throw Error("Choose a relative file inside the Home workspace");
    const result = path.resolve(this.root, value);
    if (result !== this.root && !result.startsWith(this.root + path.sep))
      throw Error("Invalid Home path");
    let current = this.root;
    for (const part of result
      .slice(this.root.length)
      .split(path.sep)
      .filter(Boolean)) {
      current = path.join(current, part);
      try {
        if ((await lstat(current)).isSymbolicLink())
          throw Error("Symbolic links are not followed");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    return result;
  }
  serial(fn) {
    const work = this.lane.catch(() => {}).then(fn);
    this.lane = work;
    return work;
  }
  async snapshot() {
    await this.ready;
    const entries = [];
    const walk = async (folder, depth) => {
      if (depth > 16) throw Error("Home folder nesting exceeds 16 levels");
      const dir = await this.resolve(folder, { directory: true });
      for (const item of await readdir(dir, { withFileTypes: true })) {
        if (item.name.startsWith(".") || item.isSymbolicLink()) continue;
        const name = folder ? folder + "/" + item.name : item.name;
        if (!item.isDirectory() && !safeName(name)) continue;
        if (entries.length >= MAX_FILES)
          throw Error("Home workspace exceeds 5000 files and folders");
        const stat = await lstat(
          await this.resolve(name, { directory: item.isDirectory() }),
        );
        if (stat.isSymbolicLink())
          throw Error("Home workspace changed while scanning");
        let metadata;
        if (
          !item.isDirectory() &&
          name.endsWith(".md") &&
          stat.size <= MAX_TEXT
        ) {
          metadata = noteMetadata((await this.read(name)).text);
        }
        entries.push({
          path: name,
          directory: item.isDirectory(),
          stat: {
            ctime: stat.birthtimeMs,
            mtime: stat.mtimeMs,
            size: stat.size,
          },
          ...(metadata ? { metadata } : {}),
        });
        if (item.isDirectory()) await walk(name, depth + 1);
      }
    };
    await walk("", 0);
    return { root: this.root, entries };
  }
  async read(value, { binary = false } = {}) {
    const file = await this.resolve(value);
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > (binary ? MAX_BINARY : MAX_TEXT))
        throw Error("File exceeds the Home size limit");
      const limit = binary ? MAX_BINARY : MAX_TEXT;
      const chunks = [];
      let size = 0;
      while (true) {
        const chunk = Buffer.alloc(Math.min(65536, limit + 1 - size));
        const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
        if (!bytesRead) break;
        size += bytesRead;
        if (size > limit) throw Error("File exceeds the Home size limit");
        chunks.push(chunk.subarray(0, bytesRead));
      }
      const bytes = Buffer.concat(chunks, size);
      return {
        path: value,
        ...(binary
          ? { base64: bytes.toString("base64") }
          : { text: bytes.toString("utf8") }),
        etag: hash(bytes),
        stat: {
          ctime: stat.birthtimeMs,
          mtime: stat.mtimeMs,
          size: bytes.length,
        },
      };
    } finally {
      await handle.close();
    }
  }
  write(request) {
    return this.serial(async () => {
      const { path: value, etag = null } = request || {};
      let bytes;
      if (typeof request?.text === "string") {
        bytes = Buffer.from(request.text);
        if (bytes.length > MAX_TEXT) throw Error("Text exceeds 2 MB");
      } else if (
        typeof request?.base64 === "string" &&
        request.base64.length <= Math.ceil(MAX_BINARY / 3) * 4 &&
        /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
          request.base64,
        )
      ) {
        bytes = Buffer.from(request.base64, "base64");
      } else throw Error("Invalid Home file data");
      const file = await this.resolve(value);
      let before = null;
      try {
        before = await this.read(value, { binary: true });
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      if ((before?.etag ?? null) !== etag)
        throw Error("The file changed. Reload before saving.");
      await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      await this.resolve(value);
      const temporary = file + "." + randomUUID() + ".tmp";
      try {
        await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
        await this.resolve(value);
        if (before) {
          const current = await this.read(value, { binary: true });
          if (current.etag !== before.etag)
            throw Error("The file changed while saving.");
          await rename(temporary, file);
        } else {
          await link(temporary, file);
          await unlink(temporary);
        }
      } catch (error) {
        await unlink(temporary).catch(() => {});
        throw error;
      }
      const stat = await lstat(file);
      return {
        path: value,
        etag: hash(bytes),
        stat: { ctime: stat.birthtimeMs, mtime: stat.mtimeMs, size: stat.size },
      };
    });
  }
  mkdir(value) {
    return this.serial(async () => {
      const target = await this.resolve(value, { directory: true });
      await mkdir(target, { recursive: true, mode: 0o700 });
      await this.resolve(value, { directory: true });
      return { path: value, directory: true };
    });
  }
  async exists(value) {
    const target = await this.resolve(value, { directory: true });
    try {
      await lstat(target);
      return true;
    } catch (error) {
      if (error.code === "ENOENT") return false;
      throw error;
    }
  }
  /** Only rebuildable wallpaper cache files can be removed through this API. User notes have no delete RPC. */
  removeCache(value) {
    return this.serial(async () => {
      if (!/^Cache\/Wallpapers\/[\w-]+\.jpg$/.test(value))
        throw Error("Only wallpaper cache files can be removed");
      await unlink(await this.resolve(value)).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
    });
  }
  async operate(request) {
    switch (request?.action) {
      case "snapshot":
        return this.snapshot();
      case "read":
        return this.read(request.path, { binary: request.binary === true });
      case "write":
        return this.write(request);
      case "mkdir":
        return this.mkdir(request.path);
      case "exists":
        return { exists: await this.exists(request.path) };
      case "remove-cache":
        await this.removeCache(request.path);
        return {};
      default:
        throw Error("Unknown Home workspace action");
    }
  }
}
