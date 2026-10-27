import { expect, it } from "vitest";
import { activeNoteBlock, buildSystemPrompt, OBSIDIAN_CONVENTIONS, RESPONSE_CONVENTIONS, selectionBlock, xmlAttr } from "../src/services/agent-prompt";
import { CLI_PROFILES, promptWithContext } from "../src/services/cli-profiles";
import { buildApiMessages } from "../src/services/api-backend";
import type { ChatRequest } from "../src/types";

const base: ChatRequest = { prompt: "把这段改得更简洁", systemPrompt: "", cwd: null, permissionMode: "edit", history: [] };

it("puts stable Obsidian conventions first, then user instructions, then AGENTS.md for API", () => {
  const prompt = buildSystemPrompt("用中文回答", "- 引用来源");
  expect(prompt.startsWith(OBSIDIAN_CONVENTIONS)).toBe(true);
  expect(prompt).toContain("用中文回答");
  expect(prompt).toContain('<vault_instructions source="AGENTS.md">\n- 引用来源');
  expect(buildSystemPrompt("x")).not.toContain("vault_instructions");
});

it("describes the editor selection with escaped attributes and 1-based lines", () => {
  expect(xmlAttr('A & "B" <c>')).toBe("A &amp; &quot;B&quot; &lt;c>");
  const selection = { path: 'a & "b".md', startLine: 3, endLine: 5, text: "选中的内容" };
  expect(selectionBlock({ selection })).toBe('<editor_selection path="a &amp; &quot;b&quot;.md" lines="3-5">\n选中的内容\n</editor_selection>');
  expect(selectionBlock({ selection: { ...selection, endLine: 3 } })).toContain('lines="3"');
  expect(selectionBlock({ selection: { ...selection, text: "  " } })).toBeNull();
  expect(activeNoteBlock({ activeFilePath: "n.md", activeFileContent: "" })).toBe('<active_note path="n.md">\n\n</active_note>');
});

it("sends the selection to both local agents and model APIs", () => {
  const request = { ...base, activeFilePath: "n.md", activeFileContent: "全文", selection: { path: "n.md", startLine: 2, endLine: 2, text: "第二行" } };
  const cli = promptWithContext(request);
  expect(cli.indexOf("<active_note")).toBeLessThan(cli.indexOf("<editor_selection"));
  expect(cli.indexOf("<editor_selection")).toBeLessThan(cli.indexOf("把这段改得更简洁"));
  const api = JSON.stringify(buildApiMessages(request));
  expect(api).toContain("editor_selection");
});

it("carries paragraph guidance to CLI while leaving explicit output instructions last", () => {
  const instruction = "只返回 JSON，不加其他文字";
  const systemPrompt = buildSystemPrompt(instruction);
  const request = { ...base, systemPrompt };
  for (const id of ["codex", "claude", "kimi", "qwen", "grok", "opencode", "pi", "gemini", "antigravity"])
    expect(CLI_PROFILES.find(p => p.id === id)!.buildArgs(request).join("\n")).toContain(RESPONSE_CONVENTIONS);
  expect(systemPrompt.indexOf(RESPONSE_CONVENTIONS)).toBeLessThan(systemPrompt.indexOf(instruction));
  expect(RESPONSE_CONVENTIONS).toContain("not verbatim quotes, replacement note text, poetry or machine-readable output");
});
