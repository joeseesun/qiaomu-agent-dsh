// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { internalLinkTarget, linkLabel, tidyInternalLinks } from "../src/services/markdown-links";

it("reads a bare path link as its note name", () => {
  expect(linkLabel("40 Resources/乌鸦的习性.md")).toBe("乌鸦的习性");
  expect(linkLabel("Books")).toBe("Books");
  expect(linkLabel("a/笔记#习性")).toBe("笔记 › 习性");
});

it("finds internal targets and keeps aliases the model chose", () => {
  const root = document.createElement("div");
  root.innerHTML = `<a class="internal-link" data-href="40 Resources/乌鸦的习性.md" href="40 Resources/乌鸦的习性.md">40 Resources/乌鸦的习性.md</a>
    <a class="internal-link" data-href="x/y.md" href="x/y.md">别名</a>
    <a class="internal-link" href="a%20b/c.md">a%20b/c.md</a>
    <a class="external-link" href="https://example.com">https://example.com</a>`;
  tidyInternalLinks(root);
  const [first, alias, encoded, external] = Array.from(root.querySelectorAll("a"));
  expect(first!.textContent).toBe("乌鸦的习性");
  expect(alias!.textContent).toBe("别名");
  expect(internalLinkTarget(encoded!)).toBe("a b/c.md");
  expect(encoded!.textContent).toBe("c");
  expect(internalLinkTarget(external!)).toBeNull();
});
