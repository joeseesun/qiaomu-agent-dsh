/** Chat font choices: host variables, fonts other plugins/themes load, and installed system fonts. */

export type ChatFontFamily = "system" | "obsidian" | "text" | "custom";
export type CodeFontFamily = "system" | "obsidian";

export interface FontChoice { family: string; label: string; source: "loaded" | "system" }

/** Common Chinese and reading fonts; only the ones actually installed are offered. */
export const SYSTEM_FONT_CANDIDATES: ReadonlyArray<readonly [family: string, label: string]> = [
  ["PingFang SC", "苹方"],
  ["Hiragino Sans GB", "冬青黑体"],
  ["Songti SC", "宋体-简"],
  ["Kaiti SC", "楷体-简"],
  ["STFangsong", "华文仿宋"],
  ["STKaiti", "华文楷体"],
  ["STSong", "华文宋体"],
  ["Lantinghei SC", "兰亭黑-简"],
  ["Yuanti SC", "圆体-简"],
  ["Microsoft YaHei", "微软雅黑"],
  ["DengXian", "等线"],
  ["SimSun", "宋体"],
  ["FangSong", "仿宋"],
  ["KaiTi", "楷体"],
  ["Source Han Sans SC", "思源黑体"],
  ["Source Han Serif SC", "思源宋体"],
  ["Noto Sans CJK SC", "Noto Sans CJK"],
  ["Noto Serif CJK SC", "Noto Serif CJK"],
  ["LXGW WenKai", "霞鹜文楷"],
  ["LXGW WenKai Screen", "霞鹜文楷 屏幕阅读版"],
  ["Helvetica Neue", "Helvetica Neue"],
  ["Georgia", "Georgia"],
  ["Charter", "Charter"],
];

// Icon, math and emoji faces that Obsidian or plugins load but that are not reading fonts.
const INTERNAL_FACE = /^(mjx|mathjax|katex|\$|lucide|codicon|fontawesome|font ?awesome|material|icon|emoji|noto color emoji|twemoji|flow circular)/i;

// Chinese names for fonts that plugins ship under a Latin (often prefixed) family name.
const FONT_ALIASES: ReadonlyArray<readonly [RegExp, string]> = [
  [/zhuque ?fangsong/i, "朱雀仿宋"],
  [/fangsong/i, "仿宋"],
  [/lxgw ?wenkai/i, "霞鹜文楷"],
  [/source ?han ?serif|noto ?serif ?(cjk|sc)/i, "思源宋体"],
  [/source ?han ?sans|noto ?sans ?(cjk|sc)/i, "思源黑体"],
];

function fontLabel(family: string): string {
  const alias = FONT_ALIASES.find(([pattern]) => pattern.test(family))?.[1];
  return alias && !family.includes(alias) ? `${alias}（${family}）` : family;
}

export function cleanFamily(value: string): string {
  return value.replace(/["'\\;{}<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
}

/** Families declared through @font-face (themes, CSS snippets and plugins such as font packs). */
export function loadedFamilies(faces: Iterable<{ family: string }>): string[] {
  const seen = new Map<string, string>();
  for (const face of faces) {
    const family = cleanFamily(face.family);
    if (family && !INTERNAL_FACE.test(family) && !seen.has(family.toLowerCase())) seen.set(family.toLowerCase(), family);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

/** Width-based check: an installed font changes the metrics against at least one generic fallback. */
export function makeFontDetector(doc: Document): (family: string) => boolean {
  const context = doc.createElement("canvas").getContext("2d");
  if (!context) return () => false;
  const sample = "永和九年岁在癸丑 mmmmmmmmwwwwwlli 0123";
  const baseline = (["monospace", "serif", "sans-serif"] as const).map((generic) => {
    context.font = `48px ${generic}`;
    return [generic, context.measureText(sample).width] as const;
  });
  return (family) => baseline.some(([generic, width]) => {
    context.font = `48px "${cleanFamily(family)}", ${generic}`;
    return Math.abs(context.measureText(sample).width - width) > 0.5;
  });
}

export function availableFonts(doc: Document, detect = makeFontDetector(doc)): FontChoice[] {
  const loaded = loadedFamilies(doc.fonts ? [...doc.fonts as unknown as Iterable<FontFace>] : []);
  const known = new Set(loaded.map((family) => family.toLowerCase()));
  const system = SYSTEM_FONT_CANDIDATES.filter(([family]) => !known.has(family.toLowerCase()) && detect(family));
  return [
    ...loaded.map((family) => ({ family, label: fontLabel(family), source: "loaded" as const })),
    ...system.map(([family, label]) => ({ family, label, source: "system" as const })),
  ];
}

const SYSTEM_STACK = `-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif`;
const MONO_STACK = `ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace`;

/** CSS font-family for the chat; a custom family falls back to the system stack when it is missing. */
export function chatFontStack(family: ChatFontFamily, custom: string): string {
  if (family === "obsidian") return "var(--font-interface)";
  if (family === "text") return "var(--font-text)";
  const name = family === "custom" ? cleanFamily(custom) : "";
  return name ? `"${name}", ${SYSTEM_STACK}` : SYSTEM_STACK;
}

export function codeFontStack(family: CodeFontFamily): string {
  return family === "obsidian" ? "var(--font-monospace)" : MONO_STACK;
}
