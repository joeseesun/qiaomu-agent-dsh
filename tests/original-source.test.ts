import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import provenance from "../vendor/qiaomu-agent/source.json";
describe("frozen original Agent source", () => {
  it("preserves every tracked source, stylesheet, test and license byte", () => {
    expect(Object.keys(provenance.files).length).toBeGreaterThan(200);
    for (const [name, expected] of Object.entries(provenance.files)) {
      const bytes = readFileSync(new URL(`../upstream/qiaomu-agent/${name}`, import.meta.url));
      expect(createHash("sha256").update(bytes).digest("hex"), name).toBe(expected);
    }
  });
});
