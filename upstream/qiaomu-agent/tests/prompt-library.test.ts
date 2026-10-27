import { describe, expect, it } from "vitest";
import { fillPrompt, promptFields } from "../src/services/prompt-template";
import {
  BUILTIN_PROMPTS, importablePrompts, isEnabled, legacyPrompts, normalizePromptSettings, parsePromptFile, promptCatalog,
  promptFileName, serializePrompt, simpleYaml, stripPrompts, cleanFolder,
} from "../src/services/prompt-library";

describe("prompt placeholders", () => {
  it("asks for blanks once each, in order, with defaults and Raycast options", () => {
    const body = '写一篇关于{{主题}}的文章，语气{{语气|轻松}}，再用{argument name="语言" options="英文, 日文"}翻译。主题再提一次：{{主题}}';
    expect(promptFields(body)).toEqual([
      { name: "主题" }, { name: "语气", defaultValue: "轻松" }, { name: "语言", defaultValue: "英文", options: ["英文", "日文"] },
    ]);
    expect(fillPrompt(body, { 主题: "睡眠", 语言: "日文" })).toBe("写一篇关于睡眠的文章，语气轻松，再用日文翻译。主题再提一次：睡眠");
  });

  it("fills context from the screen and asks for a missing selection instead", () => {
    const body = "把 {selection} 改写，参考 {note}，日期 {date}";
    const now = new Date(2026, 8, 28);
    expect(promptFields(body, { selection: "原文" })).toEqual([]);
    expect(fillPrompt(body, {}, { selection: "原文", note: "周报", now })).toBe("把 原文 改写，参考 「周报」，日期 2026年9月28日");
    expect(promptFields(body, {})).toEqual([{ name: "选中的文字", context: "selection" }]);
    expect(fillPrompt(body, { 选中的文字: "贴进来的" }, { now })).toMatch(/^把 贴进来的 改写，参考 当前笔记/);
  });

  it("leaves braces that are not placeholders alone", () => {
    const code = 'const a = { selection: 1 }; {"k": "v"} {{ }}';
    expect(promptFields(code)).toEqual([]);
    expect(fillPrompt(code, {})).toBe(code);
  });

  it("recognises the blanks in the bundled Yao learning prompts", () => {
    const cornell = BUILTIN_PROMPTS.find((item) => item.id === "yao-03-ai-learning-learning-methods-cornell-note-method")!;
    expect(promptFields(cornell.body).map((field) => field.name)).toEqual(["你的内容或书籍名称"]);
  });
});

describe("prompt library", () => {
  const user = { id: "u1", title: "周报", body: "写周报", source: "user" as const, path: "P/周报.md" };

  it("ships the scene prompts on and the curated libraries off, all with unique ids", () => {
    const settings = normalizePromptSettings({});
    const ids = BUILTIN_PROMPTS.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(BUILTIN_PROMPTS.filter((item) => item.source === "qiaomu")).toHaveLength(52);
    expect(BUILTIN_PROMPTS.filter((item) => item.source === "yao").length).toBeGreaterThan(20);
    for (const item of BUILTIN_PROMPTS) expect(isEnabled(item, settings)).toBe(item.source === "scene");
    expect(isEnabled(user, settings)).toBe(true);
    expect(isEnabled(user, normalizePromptSettings({ enabled: { u1: false } }))).toBe(false);
  });

  it("puts an edited built-in prompt in place of the original, keeping its id and scenes", () => {
    const edited = { id: "sel-polish", title: "润色（我的）", body: "按我的风格润色", source: "user" as const, path: "P/润色.md" };
    const catalog = promptCatalog([user, edited]);
    const polish = catalog.find((item) => item.id === "sel-polish")!;
    expect(polish).toMatchObject({ title: "润色（我的）", source: "scene", overrides: "scene", scenes: ["selection"], path: "P/润色.md" });
    expect(catalog.filter((item) => item.id === "sel-polish")).toHaveLength(1);
    expect(catalog[0]).toBe(user);
  });

  it("builds the strip from pins in order, then prompts that fit the screen", () => {
    const catalog = promptCatalog([user]);
    const none = normalizePromptSettings({});
    expect(stripPrompts(catalog, none, "selection").map((item) => item.id)).toEqual(["sel-polish", "sel-explain", "sel-shorten", "sel-structure"]);
    const pinned = normalizePromptSettings({ pinned: ["u1", "note-quiz", "gone"], enabled: { "note-quiz": true } });
    expect(stripPrompts(catalog, pinned, "daily").map((item) => item.id)).toEqual(["u1", "note-quiz", "daily-review", "daily-tasks", "daily-ideas"]);
    const off = normalizePromptSettings({ pinned: ["u1"], enabled: { u1: false } });
    expect(stripPrompts(catalog, off, "vault")[0]!.id).not.toBe("u1");
  });

  it("round-trips a prompt file and reads hand-written ones", () => {
    const item = { id: "u1", title: "周报: 本周", body: "写周报\n\n---\n\n分段", category: "工作", tags: ["周报", "复盘"], run: "insert" as const };
    const text = serializePrompt(item);
    expect(parsePromptFile(text, "P/周报 本周.md")).toEqual({ ...item, source: "user", path: "P/周报 本周.md" });
    expect(parsePromptFile("---\ntitle: 读书\ntags:\n  - 学习\n---\n读完这本书", "P/x.md")).toMatchObject({ id: "file:P/x.md", title: "读书", tags: ["学习"], body: "读完这本书" });
    expect(parsePromptFile("只有正文", "P/随手.md")).toMatchObject({ title: "随手", body: "只有正文" });
    expect(parsePromptFile("---\ntitle: 空\n---\n", "P/空.md")).toBeNull();
    expect(simpleYaml("a: 'it''s'\nb: [x, \"y, z\"]")).toEqual({ a: "it's", b: ["x", "y, z"] });
  });

  it("keeps file names and folders portable", () => {
    expect(promptFileName("a/b: c?  d")).toBe("a b c d");
    expect(promptFileName("  ")).toBe("未命名 Prompt");
    expect(cleanFolder("/Qiaomu Agent//Prompts/../x/")).toBe("Qiaomu Agent/Prompts/x");
    expect(normalizePromptSettings({ folder: "///" }).folder).toBe("Qiaomu Agent/Prompts");
  });

  it("imports Qiaomu-QuickPrompt and Raycast exports", () => {
    expect(importablePrompts([{ title: "A", content: "正文", category: "写作", tags: ["t"] }, { title: "空" }])).toEqual([{ title: "A", body: "正文", category: "写作", tags: ["t"] }]);
    expect(importablePrompts({ prompts: [{ title: "B", prompt: "Raycast {selection}" }] })).toEqual([{ title: "B", body: "Raycast {selection}" }]);
    expect(importablePrompts({ nope: 1 })).toEqual([]);
  });

  it("moves saved templates and edited quick prompts, and drops the untouched defaults", () => {
    const templates = [{ id: "t", name: "模板", body: "内容", pinned: true }];
    expect(legacyPrompts(templates, ["总结当前笔记", "找出相关笔记", "把这段内容整理得更清楚"])).toEqual([{ item: { id: "t", title: "模板", body: "内容" }, pinned: true }]);
    const moved = legacyPrompts(undefined, ["我的快捷问题"]);
    expect(moved).toHaveLength(1);
    expect(moved[0]).toMatchObject({ item: { title: "我的快捷问题", body: "我的快捷问题" }, pinned: true });
    expect(legacyPrompts(undefined, undefined)).toEqual([]);
  });
});

it("keeps the supplied image prompts intact, credited and insert-only", () => {
  const poster = BUILTIN_PROMPTS.find((p) => p.id === "image-window-poster")!;
  const infographic = BUILTIN_PROMPTS.find((p) => p.id === "image-x-infographic")!;
  expect(poster.title).toContain("小小东");
  expect(poster.body).toContain("【核心物象】");
  expect(infographic.body).toContain("也不要调用其他skill。");
  expect(poster.run).toBe("insert"); expect(infographic.run).toBe("insert");
});
