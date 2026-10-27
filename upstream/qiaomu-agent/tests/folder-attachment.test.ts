import { describe, expect, it } from "vitest";
import { folderAttachment, webPageAttachment, FOLDER_NOTE_LIMIT, FOLDER_TEXT_LIMIT } from "../src/services/attachments";

describe("folderAttachment", () => {
  it("joins notes under their paths, sorted", () => {
    const a = folderAttachment("Projects/Alpha", [{ path: "Projects/Alpha/b.md", text: "B" }, { path: "Projects/Alpha/a.md", text: " A\n" }]);
    expect(a.name).toBe("Alpha/");
    expect(a.vaultPath).toBe("Projects/Alpha");
    expect(a.text).toBe("## Projects/Alpha/a.md\n\nA\n\n## Projects/Alpha/b.md\n\nB");
    expect(a.size).toBe(new TextEncoder().encode(a.text!).length);
  });
  it("lists notes past the limits by path only", () => {
    const notes = Array.from({ length: FOLDER_NOTE_LIMIT + 2 }, (_, i) => ({ path: `f/${String(i).padStart(3, "0")}.md`, text: "x" }));
    const a = folderAttachment("f", notes);
    expect(a.text).toContain("另有 2 篇笔记");
    expect(a.text).toContain(`- f/${String(FOLDER_NOTE_LIMIT + 1).padStart(3, "0")}.md`);
    const big = folderAttachment("f", [{ path: "f/a.md", text: "y".repeat(FOLDER_TEXT_LIMIT) }, { path: "f/b.md", text: "z" }]);
    expect(big.text).not.toContain("yyyy");
    expect(big.text).toContain("## f/b.md");
  });
  it("says so when the folder has no notes", () => {
    expect(folderAttachment("empty", []).text).toContain("没有 Markdown 笔记");
  });
});

describe("webPageAttachment", () => {
  it("keeps the address in the text and falls back to the host name", () => {
    const a = webPageAttachment({ url: "https://example.com/a", title: " ", text: "正文" });
    expect(a.name).toBe("example.com");
    expect(a.text).toBe("来源：https://example.com/a\n\n正文");
    expect(webPageAttachment({ url: "https://example.com/a", title: "标题", text: "x" }).name).toBe("标题");
  });
});
