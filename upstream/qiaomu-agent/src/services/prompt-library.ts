import library from "../prompts/library.json";
import { STARTER_PROMPTS, SCENE_NAMES, type StarterScene } from "./starter-prompts";
import type { PromptTemplate } from "../types";

/** Where a prompt comes from. Built-in ones ship with the plugin; the user's own live as Markdown files. */
export type PromptSource = "scene" | "qiaomu" | "yao" | "user";

export interface PromptItem {
  id: string;
  title: string;
  body: string;
  source: PromptSource;
  category?: string;
  tags?: string[];
  /** Screens where a scene prompt fits; the strip suggests it there. */
  scenes?: StarterScene[];
  /** "insert" puts the prompt in the composer instead of sending it. */
  run?: "send" | "insert";
  url?: string;
  /** Vault path of the Markdown file for the user's prompts and their edits of built-in ones. */
  path?: string;
  /** Set when the user's file replaces a built-in prompt with the same id. */
  overrides?: PromptSource;
}

/** Per-prompt state kept in plugin settings; the prompts themselves stay in files or in the plugin. */
export interface PromptSettings {
  folder: string;
  /** Explicit choices; without one, scene prompts and the user's own are on, library prompts off. */
  enabled: Record<string, boolean>;
  /** Strip order. */
  pinned: string[];
  usage: Record<string, { count: number; last: number }>;
  /** The legacy quick prompts and saved templates have been moved to files. */
  migrated?: boolean;
}

export const DEFAULT_PROMPT_FOLDER = "Qiaomu Agent/Prompts";
export const DEFAULT_PROMPT_SETTINGS: PromptSettings = { folder: DEFAULT_PROMPT_FOLDER, enabled: {}, pinned: [], usage: {} };

export const SOURCE_NAMES: Record<PromptSource, string> = { scene: "场景", qiaomu: "乔木精选", yao: "Yao Open Prompts", user: "我的" };
export const LIBRARY_FROM = library.from;

export function normalizePromptSettings(raw: unknown): PromptSettings {
  const data = raw && typeof raw === "object" ? raw as Partial<Record<keyof PromptSettings, unknown>> : {};
  const folder = typeof data.folder === "string" ? cleanFolder(data.folder) : "";
  const record = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    folder: folder || DEFAULT_PROMPT_FOLDER,
    enabled: Object.fromEntries(Object.entries(record(data.enabled)).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean")),
    pinned: Array.isArray(data.pinned) ? [...new Set(data.pinned.filter((id): id is string => typeof id === "string" && id.length > 0))] : [],
    usage: Object.fromEntries(Object.entries(record(data.usage)).flatMap(([id, value]) => {
      const entry = record(value);
      return typeof entry.count === "number" && typeof entry.last === "number" ? [[id, { count: entry.count, last: entry.last }]] : [];
    })),
    ...(data.migrated === true ? { migrated: true } : {}),
  };
}

/** A vault-relative folder without leading, trailing or doubled slashes. */
export function cleanFolder(value: string): string {
  return value.split(/[\\/]+/).map((part) => part.trim()).filter((part) => part && part !== "." && part !== "..").join("/");
}

const SCENES = Object.keys(STARTER_PROMPTS) as StarterScene[];

export const BUILTIN_PROMPTS: PromptItem[] = [
  ...SCENES.flatMap((scene) => STARTER_PROMPTS[scene].map((p): PromptItem => ({ id: p.id, title: p.label, body: p.body, source: "scene", category: SCENE_NAMES[scene], scenes: [scene] }))),
  ...library.items.map((item): PromptItem => ({
    id: item.id, title: item.title, body: item.body, source: item.source === "yao" ? "yao" : "qiaomu", category: item.category,
    ...("run" in item && item.run === "insert" ? { run: "insert" as const } : {}),
    ...("url" in item && typeof item.url === "string" ? { url: item.url } : {}),
  })),
];
const BUILTIN = new Map(BUILTIN_PROMPTS.map((item) => [item.id, item]));

export const builtinPrompt = (id: string) => BUILTIN.get(id);

/** Built-in prompts with the user's edits in their place, followed by the user's own prompts. */
export function promptCatalog(userPrompts: PromptItem[]): PromptItem[] {
  const overrides = new Map<string, PromptItem>();
  const own: PromptItem[] = [];
  for (const item of userPrompts) {
    const base = BUILTIN.get(item.id);
    if (base && !overrides.has(item.id)) overrides.set(item.id, { ...base, ...item, source: base.source, overrides: base.source, scenes: base.scenes });
    else if (!base && !own.some((existing) => existing.id === item.id)) own.push(item);
  }
  return [...own, ...BUILTIN_PROMPTS.map((item) => overrides.get(item.id) ?? item)];
}

export function isEnabled(item: PromptItem, settings: PromptSettings): boolean {
  return settings.enabled[item.id] ?? (item.source === "scene" || item.source === "user");
}

/** The composer strip: pinned prompts in the user's order, then up to three that fit what is on screen. */
export function stripPrompts(catalog: PromptItem[], settings: PromptSettings, scene: StarterScene): PromptItem[] {
  const byId = new Map(catalog.map((item) => [item.id, item]));
  const pinned = settings.pinned.flatMap((id) => { const item = byId.get(id); return item && isEnabled(item, settings) ? [item] : []; });
  const lead: StarterScene[] = scene === "daily" ? ["daily", "note"] : [scene];
  const suggested = catalog.filter((item) => item.scenes?.some((s) => lead.includes(s)) && isEnabled(item, settings) && !pinned.includes(item));
  return [...pinned, ...suggested.slice(0, pinned.length ? 3 : 4)];
}

/** Case-insensitive match on title, body, category, tags and source name; every word must match. */
export function matchesPrompt(item: PromptItem, query: string): boolean {
  const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = [item.title, item.body, item.category ?? "", ...(item.tags ?? []), SOURCE_NAMES[item.source]].join("\n").toLocaleLowerCase();
  return words.every((word) => text.includes(word));
}

/** Most used first, recent use breaking ties; unused ones keep catalog order. */
export function byUsage(items: PromptItem[], settings: PromptSettings): PromptItem[] {
  const score = (item: PromptItem) => settings.usage[item.id];
  return items.map((item, index) => ({ item, index })).sort((a, b) => {
    const x = score(a.item); const y = score(b.item);
    return (y?.count ?? 0) - (x?.count ?? 0) || (y?.last ?? 0) - (x?.last ?? 0) || a.index - b.index;
  }).map((entry) => entry.item);
}

// —— Markdown files ——

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** Frontmatter as written by `serializePrompt`, tolerant of hand edits: `key: value`, `[a, b]` and `- item` lists. */
export function simpleYaml(source: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let listKey: string | null = null;
  for (const line of source.split(/\r?\n/)) {
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && listKey) { (result[listKey] as unknown[]).push(scalar(item[1]!)); continue; }
    const pair = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!pair) continue;
    const [, key, raw] = pair as unknown as [string, string, string];
    if (!raw.trim()) { result[key] = []; listKey = key; continue; }
    listKey = null;
    const list = /^\[(.*)\]$/.exec(raw.trim());
    result[key] = list ? splitList(list[1]!).map((part) => scalar(part)).filter((part) => part !== "") : scalar(raw);
  }
  return result;
}

/** Items of a flow list, keeping commas inside quoted items. */
function splitList(source: string): string[] {
  const parts: string[] = [];
  let current = ""; let quote: string | null = null;
  for (let i = 0; i < source.length; i++) {
    const char = source[i]!;
    if (quote) { current += char; if (char === "\\" && quote === '"') current += source[++i] ?? ""; else if (char === quote) quote = null; }
    else if (char === '"' || char === "'") { quote = char; current += char; }
    else if (char === ",") { parts.push(current); current = ""; }
    else current += char;
  }
  return [...parts, current];
}

function scalar(raw: string): string {
  const value = raw.trim();
  if (value.startsWith('"')) try { return String(JSON.parse(value)); } catch { /* fall through */ }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
  return value;
}

/** A prompt file: frontmatter for the name and settings, the body is the prompt. */
export function parsePromptFile(text: string, path: string, parseYaml: (source: string) => unknown = simpleYaml): PromptItem | null {
  const match = FRONTMATTER.exec(text);
  let data: Record<string, unknown> = {};
  if (match) try { const parsed = parseYaml(match[1]!); if (parsed && typeof parsed === "object") data = parsed as Record<string, unknown>; } catch { /* treat as plain text */ }
  const body = (match ? text.slice(match[0].length) : text).trim();
  if (!body) return null;
  const name = path.split("/").pop()!.replace(/\.md$/i, "");
  const text_ = (key: string) => typeof data[key] === "string" ? (data[key] as string).trim() : "";
  const tags = Array.isArray(data.tags) ? data.tags.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0).map((tag) => tag.trim()) : [];
  return {
    id: text_("id") || `file:${path}`, title: text_("title") || name, body, source: "user", path,
    ...(text_("category") ? { category: text_("category") } : {}),
    ...(tags.length ? { tags } : {}),
    ...(text_("run") === "insert" ? { run: "insert" as const } : {}),
  };
}

export function serializePrompt(item: Pick<PromptItem, "id" | "title" | "body" | "category" | "tags" | "run">): string {
  const lines = [`id: ${JSON.stringify(item.id)}`, `title: ${JSON.stringify(item.title)}`];
  if (item.category) lines.push(`category: ${JSON.stringify(item.category)}`);
  if (item.tags?.length) lines.push(`tags: [${item.tags.map((tag) => JSON.stringify(tag)).join(", ")}]`);
  if (item.run === "insert") lines.push("run: insert");
  return `---\n${lines.join("\n")}\n---\n\n${item.body.trim()}\n`;
}

/** A file name from a title: no path separators or characters other systems reject. */
export function promptFileName(title: string): string {
  const name = title.replace(/[\\/:*?"<>|#^[\]\n\r\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  return name || "未命名 Prompt";
}

// —— Import and migration ——

/** Qiaomu-QuickPrompt exports (`[{title, content}]` or `{prompts: [...]}`) and Raycast AI Commands (`[{title, prompt}]`). */
export function importablePrompts(json: unknown): Array<Pick<PromptItem, "title" | "body" | "category" | "tags">> {
  const list = Array.isArray(json) ? json : json && typeof json === "object"
    ? (["prompts", "items", "commands"] as const).map((key) => (json as Record<string, unknown>)[key]).find(Array.isArray) ?? [] : [];
  return (list as unknown[]).flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    const body = [item.content, item.prompt, item.body].find((value): value is string => typeof value === "string" && value.trim().length > 0);
    const title = [item.title, item.name].find((value): value is string => typeof value === "string" && value.trim().length > 0);
    if (!body) return [];
    const tags = Array.isArray(item.tags) ? item.tags.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0) : [];
    return [{ title: (title ?? body.split("\n")[0]!.slice(0, 30)).trim(), body: body.trim(),
      ...(typeof item.category === "string" && item.category.trim() ? { category: item.category.trim() } : {}),
      ...(tags.length ? { tags } : {}) }];
  });
}

export function exportPrompts(items: PromptItem[]): string {
  return JSON.stringify({ prompts: items.map((item) => ({ title: item.title, content: item.body, category: item.category ?? "", tags: item.tags ?? [] })) }, null, 2);
}

const LEGACY_QUICK = ["总结当前笔记", "找出相关笔记", "把这段内容整理得更清楚"];

/** Saved templates and edited quick prompts that should become files; the untouched defaults are dropped. */
export function legacyPrompts(customPrompts: PromptTemplate[] | undefined, quickPrompts: unknown): Array<{ item: Pick<PromptItem, "id" | "title" | "body">; pinned: boolean }> {
  const quick = Array.isArray(quickPrompts) ? quickPrompts.filter((text): text is string => typeof text === "string" && text.trim().length > 0) : [];
  const edited = quick.length === LEGACY_QUICK.length && quick.every((text, index) => text === LEGACY_QUICK[index]) ? [] : quick;
  return [
    ...edited.map((text) => ({ item: { id: crypto.randomUUID(), title: text.trim().split("\n")[0]!.slice(0, 40), body: text.trim() }, pinned: true })),
    ...(customPrompts ?? []).map((prompt) => ({ item: { id: prompt.id, title: prompt.name.trim() || prompt.body.slice(0, 40), body: prompt.body }, pinned: Boolean(prompt.pinned) })),
  ];
}
