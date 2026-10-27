import { describe, expect, it } from "vitest";
import { slashQuery, startsFileMention } from "../src/services/composer";
import { attachmentType, validateAttachments, attachmentContext } from "../src/services/attachments";
import type { ChatRequest } from "../src/types";
describe("composer", () => {
  it("recognizes slash commands without intercepting URLs or multiline drafts", () => {
    expect(slashQuery("/总结")).toBe("总结"); expect(slashQuery("/")).toBe("");
    expect(slashQuery("https://example.com/a")).toBeNull(); expect(slashQuery("/a\nb")).toBeNull();
  });
  it("opens mentions at token boundaries, not inside email addresses", () => {
    expect(startsFileMention("分析 @", 4)).toBe(true); expect(startsFileMention("foo@", 4)).toBe(false);
  });
  it("normalizes image extensions even with generic MIME", () => {
    expect(attachmentType("photo.PNG", "application/octet-stream")).toBe("image/png");
    expect(attachmentType("note.md")).toBe("text/plain"); expect(() => attachmentType("file.exe")).toThrow();
  });
  it("rejects unsupported backend formats and oversize batches", () => {
    const pdf = { id: "1", name: "x.pdf", mediaType: "application/pdf", size: 100, url: "data:application/pdf;base64,WA==" };
    expect(() => validateAttachments([pdf], "cli:codex")).toThrow("PDF");
    expect(() => validateAttachments([pdf], "api")).not.toThrow();
    expect(() => validateAttachments(Array(7).fill(pdf), "api")).toThrow("6");
    expect(() => validateAttachments([{ ...pdf, size: 6 * 1024 * 1024 }], "api")).toThrow("5 MB");
  });
  it("keeps the user's filename and selected text in context", () => {
    expect(attachmentContext({ attachments: [{ id: "a", name: "中文.md", mediaType: "text/plain", size: 5, text: "内容" }] } as ChatRequest)).toContain("内容");
  });
});
