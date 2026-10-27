import { describe, expect, it } from "vitest";
import { extractJsonEventText, parseSkillFrontmatter, stripAnsi, truncateMiddle } from "../src/utils";

describe("parseSkillFrontmatter", () => {
  it("reads a valid agent skill", () => {
    expect(
      parseSkillFrontmatter("---\nname: concise-writer\ndescription: Tighten prose\n---\n\nFollow the house style.")
    ).toEqual({
      name: "concise-writer",
      description: "Tighten prose",
      body: "Follow the house style.",
    });
  });

  it("rejects incomplete frontmatter", () => {
    expect(parseSkillFrontmatter("---\nname: missing-description\n---\nBody")).toBeNull();
  });

  it("reads folded multiline skill descriptions", () => {
    expect(parseSkillFrontmatter("---\nname: design\ndescription: >\n  Design interfaces.\n  Review layouts.\nmetadata:\n  author: Joe\n---\nUse this skill.")?.description)
      .toBe("Design interfaces. Review layouts.");
  });
});

describe("stream helpers", () => {
  it("extracts common text event shapes", () => {
    expect(extractJsonEventText({ type: "text_delta", delta: "hello" })).toBe("hello");
    expect(extractJsonEventText({ message: { content: [{ type: "text", text: "world" }] } })).toBe("world");
  });

  it("removes terminal colors", () => {
    expect(stripAnsi("\u001b[31merror\u001b[0m")).toBe("error");
  });

  it("truncates the middle", () => {
    expect(truncateMiddle("abcdefghijkl", 8)).toBe("abc…jkl");
  });
});
