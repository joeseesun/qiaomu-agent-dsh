import { expect, it } from "vitest";
import { STARTER_PROMPTS, starterGroups, starterScene } from "../src/services/starter-prompts";

it("picks the scene from what is on screen, most specific first", () => {
  expect(starterScene({ selection: true, reading: true, noteName: "a" })).toBe("selection");
  expect(starterScene({ selection: false, reading: true, noteName: "a" })).toBe("reading");
  expect(starterScene({ selection: false, reading: false, noteName: "读书方法" })).toBe("note");
  expect(starterScene({ selection: false, reading: false })).toBe("vault");
});

it("treats only today's daily note as the daily scene, in common naming styles", () => {
  const today = new Date(2026, 8, 27);
  for (const name of ["2026-09-27", "2026-09-27 周日", "2026_9_27", "2026.09.27", "2026年9月27日", "20260927", "2026-09-27 Sunday"])
    expect(starterScene({ selection: false, reading: false, noteName: name, today })).toBe("daily");
  for (const name of ["2026-09-26", "2026-09 计划", "2026-W39", "2026 回顾", "2026-09-27-1", "202609271", "2026-09-27 会议纪要"])
    expect(starterScene({ selection: false, reading: false, noteName: name, today })).toBe("note");
});

it("keeps the library well-formed: unique ids, and a trailing ellipsis exactly when the prompt asks for a blank", () => {
  const all = Object.values(STARTER_PROMPTS).flat();
  expect(new Set(all.map((p) => p.id)).size).toBe(all.length);
  for (const scene of Object.values(STARTER_PROMPTS)) expect(scene.length).toBeGreaterThanOrEqual(4);
  for (const p of all) expect(p.label.endsWith("…")).toBe(/\{\{[^}]+\}\}/.test(p.body));
});

it("orders menu groups by scene, and a daily note also gets note prompts", () => {
  expect(starterGroups("daily")).toEqual(["daily", "note", "vault"]);
  expect(starterGroups("vault")).toEqual(["vault"]);
  expect(starterGroups("reading", true)).toEqual(["reading", "selection", "daily", "note", "vault"]);
});

it("asks for exactly three sentences as separate paragraphs in the reading shortcut", () => {
  const prompt = STARTER_PROMPTS.reading.find(p => p.id === "read-three")!;
  expect(prompt.body).toContain("严格三句话");
  expect(prompt.body).toContain("每句独立一段");
  expect(prompt.body).toContain("段落之间留一个空行");
  expect(prompt.body).toContain("不加标题或编号");
});
