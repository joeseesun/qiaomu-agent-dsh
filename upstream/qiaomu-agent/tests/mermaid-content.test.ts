import { expect, it } from "vitest";
import { splitMermaid } from "../src/services/mermaid-content";
import { sizeSvg, svgDataUrl, withTheme } from "../src/services/host-mermaid";

it("extracts complete Mermaid without passing its fence to the host trust processor", () => {
  expect(splitMermaid("前文\n```mermaid\nflowchart LR\nA --> B\n```\n后文")).toEqual([
    { kind: "markdown", text: "前文" }, { kind: "mermaid", text: "flowchart LR\nA --> B" }, { kind: "markdown", text: "后文" },
  ]);
});
it("keeps incomplete streams and nested fences as code until complete", () => {
  const incomplete = "```mermaid\nflowchart LR\nA -->";
  expect(splitMermaid(incomplete)).toEqual([{ kind: "pending", text: "flowchart LR\nA -->" }]);
  const nested = "````markdown\n```mermaid\nA-->B\n```\n````";
  expect(splitMermaid(nested)).toEqual([{ kind: "markdown", text: nested }]);
  expect(splitMermaid("~~~mermaid\ngraph LR\nA-->B\n~~~")[0]?.kind).toBe("mermaid");
});
it("themes per diagram without overriding an author's own init directive", () => {
  expect(withTheme("graph LR\nA-->B", "dark")).toBe('%%{init: {"theme": "dark"}}%%\ngraph LR\nA-->B');
  const custom = '%%{init: {"theme": "forest"}}%%\ngraph LR';
  expect(withTheme(custom, "neutral")).toBe(custom);
});
