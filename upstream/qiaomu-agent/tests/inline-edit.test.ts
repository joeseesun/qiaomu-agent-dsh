import { describe, expect, it } from "vitest";
import type { Editor } from "obsidian";
import { diffWords, inlineTargetIsCurrent, parseInlineReplacement } from "../src/services/inline-edit";

describe("inline note rewrite", () => {
  it("accepts only a delimited replacement", () => {
    expect(parseInlineReplacement("说明\n<replacement>第一行\n第二行</replacement>")).toBe("第一行\n第二行");
    expect(() => parseInlineReplacement("我会修改文件")).toThrow("可预览");
  });

  it("refuses to apply after another edit or note switch", () => {
    let document = "开头\n原文\n结尾";
    const editor = {
      getValue: () => document,
      getRange: () => document.split("\n")[1],
    } as unknown as Editor;
    const target = { editor, path: "note.md", from: { line: 1, ch: 0 }, to: { line: 1, ch: 2 }, original: "原文", document };
    expect(inlineTargetIsCurrent(target, "note.md")).toBe(true);
    expect(inlineTargetIsCurrent(target, "other.md")).toBe(false);
    document = "开头\n后来改了\n结尾";
    expect(inlineTargetIsCurrent(target, "note.md")).toBe(false);
  });

  it("shows Chinese word additions and deletions while preserving unchanged words", () => {
    const changes = diffWords("这段写得不错。", "这段写得更清楚。");
    expect(changes.filter((change) => change.type === "del").map((change) => change.text).join("")).toContain("不错");
    expect(changes.filter((change) => change.type === "add").map((change) => change.text).join("")).toContain("更清楚");
    expect(changes.filter((change) => change.type === "same").map((change) => change.text).join("")).toContain("这段");
  });
});
