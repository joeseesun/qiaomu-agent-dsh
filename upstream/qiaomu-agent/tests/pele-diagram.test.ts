import { describe, expect, it, vi } from "vitest";
vi.mock("obsidian", () => ({ sanitizeHTMLToDom: vi.fn() }));
import { parse, render } from "pele/core";
import { isDiagramLimit, PELE_LIMITS, supportsPele } from "../src/services/pele-diagram";

const fixtures = [
  'flowchart LR\n A[读取中文笔记] --> B{是否需要工具}\n B -->|需要| C[调用工具并检查结果]\n B -->|不需要| D[生成回答]\n C --> D',
  'sequenceDiagram\n participant U as 用户\n participant A as 乔木助手\n U->>A: 总结笔记\n A-->>U: 中文摘要',
  'mindmap\n root((知识管理))\n  输入\n   阅读\n  输出\n   写作',
];
describe("bounded Pele adoption", () => {
  it.each(fixtures)("renders the supported source at desktop and sidebar widths: %s", (source) => {
    expect(supportsPele(source)).toBe(true);
    for (const maxWidth of [800, 280]) {
      const result = render(source, { ...PELE_LIMITS, maxWidth, links: false, images: false });
      expect(result.svg).toMatch(/^<svg/);
      expect(result.width).toBeGreaterThan(0);
      expect(result.height).toBeGreaterThan(0);
      expect(result.svg).toContain("var(--pele-");
    }
  });
  it("reflows a wide Chinese flowchart instead of just shrinking it", () => {
    const wide = render(fixtures[0]!, { maxWidth: 800 });
    const narrow = render(fixtures[0]!, { maxWidth: 280 });
    expect(narrow.width).toBeLessThan(wide.width);
    expect(narrow.height).toBeGreaterThan(wide.height);
  });
  it("leaves other diagram types to the host and does not mistake detection for validation", () => {
    expect(supportsPele('pie\n "中文" : 60')).toBe(false);
    expect(supportsPele("flowchart TD\n A[")).toBe(true);
    expect(() => parse("flowchart TD\n A[")).toThrow();
  });
  it("does not allow links, images, scripts or HTML labels in local SVG output", () => {
    const result = render('flowchart LR\n A["<img src=https://example.com/x onerror=alert(1)>"] --> B[文档]\n click B "https://example.com"', { ...PELE_LIMITS, links: false, images: false });
    expect(result.links).toEqual([]);
    expect(result.svg).not.toMatch(/<(?:a|image|script|foreignObject)\b|\sonerror=/i);
  });
  it("rejects source and edge limits so callers can avoid a fallback that bypasses them", () => {
    for (const source of ["flowchart TD\n" + " ".repeat(20_000), "flowchart TD\n" + Array.from({ length: 501 }, (_, i) => `n${i} --> n${i + 1}`).join("\n")]) {
      let error: unknown;
      try { render(source, PELE_LIMITS); } catch (caught) { error = caught; }
      expect(isDiagramLimit(error)).toBe(true);
    }
    expect(isDiagramLimit(new Error("other"))).toBe(false);
  });
});
