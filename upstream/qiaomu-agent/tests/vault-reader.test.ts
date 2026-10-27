import { describe, expect, it } from "vitest";
import type { App, TFile } from "obsidian";
import { readVaultNote, searchVaultNotes, vaultPathFromInput } from "../src/services/vault-reader";

const file = { path: "Notes/Example.md", extension: "md", stat: { size: 20 } } as TFile;
const app = {
  vault: {
    getName: () => "My Vault",
    getAbstractFileByPath: (path: string) => path === file.path ? file : null,
    getMarkdownFiles: () => [file],
    cachedRead: async () => "A note about search and agents.",
  },
  metadataCache: { getFirstLinkpathDest: () => null },
} as unknown as App;

describe("API vault reading", () => {
  it("resolves an Obsidian open URL and reads its Markdown", async () => {
    expect(vaultPathFromInput(app, "obsidian://open?vault=My%20Vault&file=Notes%2FExample.md")).toBe(file.path);
    expect(await readVaultNote(app, "[[Notes/Example.md]]")).toMatchObject({ path: file.path, text: "A note about search and agents." });
  });
  it("rejects plugin actions and paths outside the vault", () => {
    expect(() => vaultPathFromInput(app, "obsidian://qiaomu-ai-rss/open?id=1")).toThrow("插件动作");
    expect(() => vaultPathFromInput(app, "../secret.md")).toThrow();
    expect(() => vaultPathFromInput(app, "obsidian://open?vault=Other&file=Notes%2FExample.md")).toThrow("另一个");
  });
  it("searches note text and returns a bounded snippet", async () => {
    expect(await searchVaultNotes(app, "search", new AbortController().signal)).toEqual({
      matches: [{ path: file.path, snippet: "A note about search and agents." }], scanned: 1, limited: false,
    });
  });
});
