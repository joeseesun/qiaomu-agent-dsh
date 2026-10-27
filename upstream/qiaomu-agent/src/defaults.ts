import { manualProviderModels } from "./services/provider-models";
import type { ModelChoice, QiaomuSettings } from "./types";
import { migrateProviders } from "./services/model-sources";
import { recommendedModels } from "./services/key-detection";
import { normalizeBranchTitle } from "./services/conversations";
import { normalizeChatTheme } from "./services/palettes";
import { DEFAULT_PROMPT_SETTINGS, normalizePromptSettings } from "./services/prompt-library";
import { cleanFamily } from "./services/fonts";

export const DEFAULT_SYSTEM_PROMPT = `你是用户 Obsidian 知识库中的协作助手。

遵守以下原则：
1. 优先理解当前笔记与用户明确提供的上下文。
2. 引用库内文件时使用 [[路径/文件名.md]]，让结果可以在 Obsidian 中打开。
3. 修改文件前说明目标和意图；不要覆盖对话开始后发生的新编辑。
4. 保留用户原有 Markdown、YAML frontmatter、内部链接和中文排版风格。
5. 回答简洁、具体，可执行。`;

export const DEFAULT_SETTINGS: QiaomuSettings = {
  schemaVersion: 1,
  backendKind: "auto",
  preferredCli: "",
  permissionMode: "plan",
  api: {
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-5-mini",
    secretId: "qiaomu-agent-api-key",
  },
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  prompts: DEFAULT_PROMPT_SETTINGS,
  autoAttachActiveNote: true,
  useObsidianCli: true,
  skillDirectories: [],
  disabledSkillPaths: [],
  mcpConfig: "{\n  \"mcpServers\": {}\n}",
  disabledMcpServers: [],
  lastConversation: [],
  providers: [],
  recentModels: [],
  hiddenAgents: [],
  agentVisibility: {},
  chatTheme: "auto",
  chatFontFamily: "system",
  chatFontCustom: "",
  codeFontFamily: "system",
  chatFontSize: 15,
  codeFontSize: 13,
  agentModelCache: {},
  agentEnabledModels: { pi: [""] },
  agentCustomModels: {},
};

export function normalizeSettings(raw: unknown): QiaomuSettings {
  const data = raw && typeof raw === "object" ? (raw as Partial<QiaomuSettings>) : {};
  const api = data.api && typeof data.api === "object" ? data.api : DEFAULT_SETTINGS.api;

  return {
    ...DEFAULT_SETTINGS,
    // Unknown keys are kept on purpose: Qiaomu Publish imports the old `wechat` block from here.
    ...data,
    schemaVersion: 1,
    permissionMode: data.permissionMode === "edit" || data.permissionMode === "full" ? data.permissionMode : "plan",
    prompts: normalizePromptSettings(data.prompts),
    customPrompts: Array.isArray(data.customPrompts) ? data.customPrompts.filter((p) => p && typeof p.id === "string" && typeof p.name === "string" && typeof p.body === "string")
      .map((p) => ({ id: p.id, name: p.name, body: p.body, pinned: p.pinned === true })) : [],
    activeConversation: data.activeConversation && typeof data.activeConversation.id === "string" && typeof data.activeConversation.title === "string"
      ? normalizeBranchTitle({ ...data.activeConversation, createdAt: Number.isFinite(data.activeConversation.createdAt) ? data.activeConversation.createdAt : Date.now() }) : undefined,
    conversations: Array.isArray(data.conversations) ? data.conversations.filter((c) => c && typeof c.id === "string" && typeof c.title === "string" && Array.isArray(c.messages))
      .map((c) => normalizeBranchTitle({ ...c, createdAt: Number.isFinite(c.createdAt) ? c.createdAt : Date.now() })).slice(0, 30) : [],
    modelSelections: data.modelSelections && typeof data.modelSelections === "object" && !Array.isArray(data.modelSelections) ? Object.fromEntries(Object.entries(data.modelSelections).filter(([, v]) => v && typeof v.model === "string" && typeof v.effort === "string")) : {},
    api: { ...DEFAULT_SETTINGS.api, ...api },
    // The built-in default connection is only listed once a key exists for it (checked on load).
    providers: migrateProviders(data, { ...DEFAULT_SETTINGS.api, ...api })
      .filter((item) => Array.isArray(data.providers) || item.secretId !== DEFAULT_SETTINGS.api.secretId)
      // "Nothing selected = everything" is gone: never-curated providers start with recommended models.
      .map((item) => ({
        ...item,
        manualModels: manualProviderModels(item),
        removedModels: Array.isArray(item.removedModels) ? [...new Set(item.removedModels.filter(id => typeof id === "string"))] : [],
        enabledModels: Array.isArray(item.enabledModels) ? item.enabledModels : recommendedModels(item.provider, item.models ?? []),
        showInPicker: item.showInPicker !== false,
        modelOptions: Object.fromEntries(Object.entries(item.modelOptions ?? {}).filter(([id, value]) => typeof id === "string" && value && typeof value === "object")
          .map(([id, value]) => [id, {
            ...(typeof value.temperature === "number" && value.temperature >= 0 && value.temperature <= 2 ? { temperature: value.temperature } : {}),
            ...(typeof value.maxOutputTokens === "number" && Number.isInteger(value.maxOutputTokens) && value.maxOutputTokens >= 1 && value.maxOutputTokens <= 1_000_000 ? { maxOutputTokens: value.maxOutputTokens } : {}),
            ...(typeof value.contextWindow === "number" && Number.isInteger(value.contextWindow) && value.contextWindow >= 1 && value.contextWindow <= 100_000_000 ? { contextWindow: value.contextWindow } : {}),
            ...(typeof value.reasoning === "boolean" ? { reasoning: value.reasoning } : {}),
            ...(typeof value.vision === "boolean" ? { vision: value.vision } : {}),
          }])),
      })),
    recentModels: Array.isArray(data.recentModels) ? data.recentModels.filter((item) => item && typeof item.source === "string" && typeof item.model === "string").slice(0, 8) : [],
    hiddenAgents: Array.isArray(data.hiddenAgents) ? data.hiddenAgents.filter((id): id is string => typeof id === "string") : [],
    agentVisibility: data.agentVisibility && typeof data.agentVisibility === "object" && !Array.isArray(data.agentVisibility)
      ? Object.fromEntries(Object.entries(data.agentVisibility).filter(([id, value]) => id.length > 0 && typeof value === "boolean")) : {},
    chatTheme: normalizeChatTheme(data.chatTheme),
    chatFontFamily: data.chatFontFamily === "obsidian" || data.chatFontFamily === "text" || data.chatFontFamily === "custom" && typeof data.chatFontCustom === "string" && cleanFamily(data.chatFontCustom) ? data.chatFontFamily : "system",
    chatFontCustom: typeof data.chatFontCustom === "string" ? cleanFamily(data.chatFontCustom) : "",
    codeFontFamily: data.codeFontFamily === "obsidian" ? "obsidian" : "system",
    chatFontSize: typeof data.chatFontSize === "number" && Number.isInteger(data.chatFontSize) && data.chatFontSize >= 13 && data.chatFontSize <= 20 ? data.chatFontSize : 15,
    codeFontSize: typeof data.codeFontSize === "number" && Number.isInteger(data.codeFontSize) && data.codeFontSize >= 12 && data.codeFontSize <= 18 ? data.codeFontSize : 13,
    agentModelCache: normalizeModelCache(data.agentModelCache),
    agentEnabledModels: { pi: [""], ...normalizeAgentIds(data.agentEnabledModels) },
    agentCustomModels: normalizeAgentIds(data.agentCustomModels, false),
    ...(Array.isArray(data.quickPrompts) ? { quickPrompts: data.quickPrompts.filter((item): item is string => typeof item === "string").slice(0, 8) } : {}),
    skillDirectories: Array.isArray(data.skillDirectories)
      ? data.skillDirectories.filter((item): item is string => typeof item === "string")
      : [],
    disabledSkillPaths: Array.isArray(data.disabledSkillPaths)
      ? data.disabledSkillPaths.filter((item): item is string => typeof item === "string") : [],
    disabledMcpServers: Array.isArray(data.disabledMcpServers)
      ? data.disabledMcpServers.filter((item): item is string => typeof item === "string") : [],
    lastConversation: Array.isArray(data.lastConversation)
      ? data.lastConversation.filter((item) => item && typeof item.content === "string").slice(-80)
      : [],
  };
}

function normalizeAgentIds(raw: unknown, allowDefault = true): Record<string, string[]> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw as Record<string, unknown>)
    .filter(([, value]) => Array.isArray(value))
    .map(([agent, value]) => [agent, [...new Set((value as unknown[])
      .filter((id): id is string => typeof id === "string" && (allowDefault || Boolean(id.trim())))
      .map((id) => id.trim()))].slice(0, 200)]));
}

function normalizeModelCache(raw: unknown): QiaomuSettings["agentModelCache"] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const result: QiaomuSettings["agentModelCache"] = {};
  for (const [key, value] of Object.entries(raw as Record<string, { models?: unknown; fetchedAt?: unknown }>)) {
    if (!Array.isArray(value?.models)) continue;
    const models = value.models.filter((m): m is ModelChoice => Boolean(m && typeof (m as ModelChoice).id === "string"))
      .map((m) => ({ id: m.id, name: typeof m.name === "string" ? m.name : m.id, efforts: Array.isArray(m.efforts) ? m.efforts.filter((e) => typeof e === "string") : [] }));
    // Earlier builds truncated Pi's 427-entry catalog at 200. Reload it once on next use.
    if (key === "pi" && models.length === 200) continue;
    result[key] = { models: models.slice(0, 1000), fetchedAt: typeof value.fetchedAt === "number" ? value.fetchedAt : 0 };
  }
  return result;
}
