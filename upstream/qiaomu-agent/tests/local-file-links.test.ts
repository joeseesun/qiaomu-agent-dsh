// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { posix } from "node:path";
import { Platform, type App } from "obsidian";
import * as obsidian from "obsidian";
import { localFileTarget, openLocalFile } from "../src/services/local-file-links";
import { artifactText } from "../src/i18n/artifacts";

const app = { vault: { adapter: { getBasePath: () => "/vault", getResourcePath: (path: string) => `app://local/vault/${encodeURI(path)}` }, getFiles: () => [{ path: "images/生成 图.png" }] }, metadataCache: { getFirstLinkpathDest: vi.fn((path: string) => path === "song.mp3" ? { path: "media/song.mp3" } : null) } } as unknown as App;
const stat = vi.fn(async () => ({}));
const shell = { openPath: vi.fn(async () => ""), showItemInFolder: vi.fn() };
const load = vi.fn((id: string) => id === "path" ? posix : id === "fs" ? { promises: { stat } } : id === "os" ? { homedir: () => "/Users/test" } : id === "electron" ? { shell } : null);
const prepare = () => Object.assign(window, { require: load });
afterEach(() => { delete (window as unknown as { require?: unknown }).require; vi.clearAllMocks(); vi.restoreAllMocks(); stat.mockResolvedValue({}); shell.openPath.mockResolvedValue(""); Platform.isDesktopApp = true; });

it("resolves absolute paths, file URLs, home paths and encoded Unicode without note routing", () => {
  expect(localFileTarget(app, "/Users/test/Downloads/song.mp3")).toEqual({ path: "/Users/test/Downloads/song.mp3" });
  expect(localFileTarget(app, "file:///Users/test/%E5%9B%BE%20%231.png")).toEqual({ path: "/Users/test/图 #1.png" });
  expect(localFileTarget(app, "file:///C:/Users/Test/a%20b.png")).toEqual({ path: "C:/Users/Test/a b.png" });
  expect(localFileTarget(app, "C:\\Users\\Test\\a.png")).toEqual({ path: "C:\\Users\\Test\\a.png" });
  expect(localFileTarget(app, "~/Downloads/a.mp3")).toEqual({ path: "~/Downloads/a.mp3" });
});
it("resolves vault artifacts and generated-image resource URLs, leaving notes and web links alone", () => {
  expect(localFileTarget(app, "song.mp3", "Notes/a.md")).toEqual({ path: "media/song.mp3", base: "/vault" });
  expect(localFileTarget(app, "missing.png", "Notes/a.md")).toEqual({ path: "Notes/missing.png", base: "/vault" });
  expect(localFileTarget(app, "app://local/vault/images/生成%20图.png?cache=1")).toEqual({ path: "images/生成 图.png", base: "/vault" });
  for (const link of ["Notes/a.md#heading", "My note", "a.canvas", "https://example.com/a.png", "data:image/png;base64,AA==", "#heading"]) expect(localFileTarget(app, link)).toBeNull();
});
it("opens an existing file in its default application and reveals it through the shell", async () => {
  prepare();
  await openLocalFile(app, "song.mp3", "Notes/a.md");
  expect(shell.openPath).toHaveBeenCalledWith("/vault/media/song.mp3");
  await openLocalFile(app, "~/Downloads/生成 图.png", "", true);
  expect(shell.showItemInFolder).toHaveBeenCalledWith("/Users/test/Downloads/生成 图.png");
  expect(shell.openPath).toHaveBeenCalledOnce();
});
it("reports a missing file or application error without opening or creating a note", async () => {
  prepare();stat.mockRejectedValueOnce(new Error("ENOENT"));
  await expect(openLocalFile(app, "/missing.mp3")).rejects.toThrow("文件不存在");
  expect(shell.openPath).not.toHaveBeenCalled();
  shell.openPath.mockResolvedValueOnce("No application");
  await expect(openLocalFile(app, "/present.mp3")).rejects.toThrow("No application");
});
it("keeps desktop APIs unloaded on mobile and uses translated labels and error details", async () => {
  prepare();Platform.isDesktopApp = false;
  await expect(openLocalFile(app, "/present.png")).rejects.toThrow("桌面端");
  expect(load).not.toHaveBeenCalled();
  vi.spyOn(obsidian, "getLanguage").mockReturnValue("en-US");
  expect(artifactText("finder")).toBe("Show in Finder");
  expect(artifactText("missing", { path: "/图.png" })).toBe("File does not exist or cannot be accessed: /图.png");
  vi.spyOn(obsidian, "getLanguage").mockReturnValue("ja");
  expect(artifactText("open")).toBe("打开文件");
});
