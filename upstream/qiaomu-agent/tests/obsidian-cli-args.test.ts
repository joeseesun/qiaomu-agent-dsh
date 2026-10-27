import { describe, expect, it } from "vitest";
import { buildObsidianCliArgs } from "../src/services/obsidian-cli-args";

describe("buildObsidianCliArgs", () => {
  it("builds exact read and property commands", () => {
    expect(buildObsidianCliArgs({ type: "read", path: "中文/项目.md" })).toEqual([
      "read",
      "path=中文/项目.md",
    ]);
    expect(
      buildObsidianCliArgs({ type: "property-set", path: "项目.md", name: "status", value: "done" })
    ).toEqual(["property:set", "name=status", "value=done", "path=项目.md"]);
  });

  it("clamps search limits", () => {
    expect(buildObsidianCliArgs({ type: "search", query: "AI", limit: 999 })).toContain("limit=100");
  });

  it("rejects paths outside the vault", () => {
    expect(() => buildObsidianCliArgs({ type: "read", path: "../secret.md" })).toThrow(/Vault/);
    expect(() => buildObsidianCliArgs({ type: "read", path: "/tmp/file.md" })).toThrow(/Vault/);
  });
});
