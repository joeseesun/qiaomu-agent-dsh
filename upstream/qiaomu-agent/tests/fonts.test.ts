import { describe, expect, it } from "vitest";
import { availableFonts, chatFontStack, cleanFamily, codeFontStack, loadedFamilies } from "../src/services/fonts";
import { normalizeSettings } from "../src/defaults";

describe("chat fonts", () => {
  it("lists fonts loaded by themes and plugins, without icon or math faces", () => {
    expect(loadedFamilies([{ family: "\"朱雀仿宋\"" }, { family: "朱雀仿宋" }, { family: "MJXZERO" }, { family: "KaTeX_Main" }, { family: "LXGW WenKai" }]))
      .toEqual(["朱雀仿宋", "LXGW WenKai"]);
  });

  it("adds installed system fonts once, after loaded ones", () => {
    const doc = { fonts: [{ family: "朱雀仿宋" }, { family: "PingFang SC" }] } as unknown as Document;
    const fonts = availableFonts(doc, (family) => family === "PingFang SC" || family === "Songti SC");
    expect(fonts.map((font) => [font.family, font.source])).toEqual([["朱雀仿宋", "loaded"], ["PingFang SC", "loaded"], ["Songti SC", "system"]]);
  });

  it("builds stacks that fall back and cannot break out of the declaration", () => {
    expect(chatFontStack("custom", "朱雀仿宋")).toMatch(/^"朱雀仿宋", -apple-system/);
    expect(chatFontStack("custom", "x\"; color: red")).toMatch(/^"x color: red", /);
    expect(chatFontStack("custom", "")).toMatch(/^-apple-system/);
    expect(chatFontStack("text", "")).toBe("var(--font-text)");
    expect(chatFontStack("obsidian", "")).toBe("var(--font-interface)");
    expect(codeFontStack("obsidian")).toBe("var(--font-monospace)");
    expect(cleanFamily("  a   b ")).toBe("a b");
  });

  it("normalizes saved font settings", () => {
    expect(normalizeSettings({ chatFontFamily: "custom", chatFontCustom: "朱雀仿宋" })).toMatchObject({ chatFontFamily: "custom", chatFontCustom: "朱雀仿宋", codeFontFamily: "system" });
    expect(normalizeSettings({ chatFontFamily: "custom", chatFontCustom: "" }).chatFontFamily).toBe("system");
    expect(normalizeSettings({ chatFontFamily: "text", codeFontFamily: "obsidian" })).toMatchObject({ chatFontFamily: "text", codeFontFamily: "obsidian" });
    expect(normalizeSettings({ chatFontFamily: "comic" }).chatFontFamily).toBe("system");
  });
});

describe("font labels", () => {
  it("names plugin fonts in Chinese and hides Obsidian's placeholder face", () => {
    const doc = { fonts: [{ family: "QBR Zhuque Fangsong" }, { family: "Flow Circular" }] } as unknown as Document;
    expect(availableFonts(doc, () => false)).toEqual([{ family: "QBR Zhuque Fangsong", label: "朱雀仿宋（QBR Zhuque Fangsong）", source: "loaded" }]);
  });
});
