import { expect, it, vi } from "vitest";
vi.mock("obsidian", () => ({ TFile: class {} }));
import { appendedText, undoAppend } from "../src/services/note-actions";
it("appends Markdown with paragraph separation", () => {
  expect(appendedText("原文", "**回复**")).toBe("原文\n\n**回复**\n");
  expect(appendedText("原文\n\n", "回复")).toBe("原文\n\n回复\n");
});
it("undo preserves subsequent appends but rejects edits in the affected prefix", () => {
  const receipt = { path: "x.md", prefix: "原文", suffix: "\n\n回复\n" };
  expect(undoAppend("原文\n\n回复\n新内容", receipt)).toBe("原文新内容");
  expect(() => undoAppend("改过原文\n\n回复\n", receipt)).toThrow("无法安全撤销");
});
