import { hasPrivateHttpConsent } from "./network-hosts";
import { connectionText as ct } from "../i18n/connection";
import type { ApiConnection, ModelChoice, ProviderConfig, QiaomuSettings } from "../types";
import { providerModels } from "./provider-models";
import { API_PROVIDERS, apiProtocol, validateApiUrl, permitsEmptyKey } from "./api-providers";
import { recommendedModels } from "./key-detection";
import { resolveModel } from "./model-capabilities";

/** A place models come from: a local agent (`cli:<id>`) or a configured provider (`api:<providerId>`). */
export interface ModelSource {
  key: string;
  kind: "agent" | "api";
  label: string;
  icon?: string;
  models: ModelChoice[];
  loading?: boolean;
  error?: string;
  /** Local agents may not have reported models yet. */
  loaded: boolean;
  showDefault?: boolean;
  allowCustom?: boolean;
  canListModels?: boolean;
}

/** Keep the settings list scannable; discovery itself determines which agents can be shown. */
export const DEFAULT_VISIBLE_AGENT_IDS = ["codex", "claude", "opencode", "pi", "cursor", "antigravity", "kimi"] as const;

export function agentShown(settings: QiaomuSettings, id: string): boolean {
  if (settings.hiddenAgents.includes(id)) return false;
  return settings.agentVisibility[id] ?? true;
}

export function visibleAgentModels(settings: QiaomuSettings, agentId: string, reported: ModelChoice[]): { models: ModelChoice[]; showDefault: boolean } {
  const enabled = settings.agentEnabledModels[agentId];
  const all = [...reported];
  for (const id of settings.agentCustomModels[agentId] ?? []) {
    if (!all.some((model) => model.id === id)) all.push({ id, name: id, efforts: [] });
  }
  return { models: enabled ? all.filter((model) => enabled.includes(model.id)) : all, showDefault: !enabled || enabled.includes("") };
}

export const RECENT_LIMIT = 8;

export function providerLabel(provider: ProviderConfig): string {
  return provider.name?.trim() || API_PROVIDERS[provider.provider]?.label || provider.provider;
}

export function providerIcon(provider: ProviderConfig): string | undefined {
  return API_PROVIDERS[provider.provider]?.icon;
}

export function providerHost(provider: Pick<ApiConnection, "baseUrl">): string {
  try { return new URL(provider.baseUrl).host; } catch { return provider.baseUrl || "未设置地址"; }
}

/** `sk-abcdef…1234` → `sk-a…1234`; never reveals more than 8 characters. */
export function maskKey(key: string): string {
  const value = key.trim();
  if (!value) return "";
  if (value.length <= 8) return "••••";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

/** Models the picker offers: exactly the enabled ones (explicit list), plus the configured default. */
export function exposedModels(provider: ProviderConfig): ModelChoice[] {
  const all = providerModels(provider);
  // Efforts follow the per-model thinking setting, so a switch in settings shows up in the picker.
  return (provider.enabledModels ?? []).map((id) => ({ ...(all.find((model) => model.id === id) ?? { id, name: id }), efforts: resolveModel(provider, id).efforts }));
}

/** Saving a connection does not claim a successful network or model test. */
export function addProviderConnection(
  settings: QiaomuSettings, presetId: string, key: string,
  setSecret: (id: string, value: string) => void,
  endpoint: { baseUrl?: string; protocol?: ApiConnection["protocol"]; name?: string; privateHttpApprovedUrl?: string } = {},
): ProviderConfig {
  const provider = { ...newProvider(presetId, settings.providers), ...endpoint, models: [], enabledModels: [] };
  provider.baseUrl = validateApiUrl(provider.baseUrl, hasPrivateHttpConsent(provider));
  if (!key.trim() && !permitsEmptyKey(provider)) throw new Error(ct("missingKey"));
  setSecret(provider.secretId, key.trim());
  upsertProvider(settings, provider);
  return provider;
}

/** Roll back this provider and active pointer on a failed disk write, without erasing other edits. */
export async function persistProviderChange(
  settings: QiaomuSettings, change: () => ProviderConfig, persist: () => Promise<void>,
): Promise<ProviderConfig> {
  const previous = new Map(settings.providers.map((provider) => [provider.id, provider]));
  const previousApi = settings.api;
  const provider = change();
  const nextApi = settings.api;
  try { await persist(); return provider; }
  catch (error) {
    const index = settings.providers.findIndex((item) => item.id === provider.id);
    if (index >= 0 && settings.providers[index] === provider) {
      const old = previous.get(provider.id);
      if (old) settings.providers[index] = old;
      else settings.providers.splice(index, 1);
    }
    if (settings.api === nextApi) settings.api = previousApi;
    throw error;
  }
}

function connectionOf(provider: ProviderConfig): ApiConnection {
  return { provider: provider.provider, protocol: provider.protocol ?? apiProtocol(provider), baseUrl: provider.baseUrl, privateHttpApprovedUrl: provider.privateHttpApprovedUrl, model: provider.model, secretId: provider.secretId };
}

function sameEndpoint(a: ApiConnection, b: ApiConnection): boolean {
  return a.provider === b.provider && a.baseUrl === b.baseUrl && a.secretId === b.secretId;
}

/** Builds the provider list from the pre-list settings shape (`api` + `apiProfiles`). */
export function migrateProviders(raw: Partial<QiaomuSettings>, api: ApiConnection): ProviderConfig[] {
  if (Array.isArray(raw.providers)) {
    return raw.providers
      .filter((item): item is ProviderConfig => Boolean(item && typeof item.id === "string" && typeof item.provider === "string" && typeof item.secretId === "string"))
      .map((item) => ({ ...item, baseUrl: typeof item.baseUrl === "string" ? item.baseUrl : "", model: typeof item.model === "string" ? item.model : "" }));
  }
  const connections = [...Object.values(raw.apiProfiles ?? {}), api]
    .filter((item): item is ApiConnection => Boolean(item && typeof item.provider === "string" && typeof item.secretId === "string"));
  const providers: ProviderConfig[] = [];
  for (const connection of connections) {
    if (providers.some((item) => sameEndpoint(item, connection))) continue;
    const id = providers.some((item) => item.id === connection.provider) || connection.provider === "custom"
      ? `${connection.provider}-${providers.length + 1}`
      : connection.provider;
    providers.push({ ...connection, id });
  }
  return providers;
}

export function findProvider(settings: QiaomuSettings, id: string): ProviderConfig | undefined {
  return settings.providers.find((item) => item.id === id);
}

/** The provider `settings.api` currently points at, if it is in the list. */
export function activeProvider(settings: QiaomuSettings): ProviderConfig | undefined {
  return settings.providers.find((item) => sameEndpoint(item, settings.api));
}

const SECRET_ID_PREFIX = "qiaomu-agent-";
const SECRET_ID_MAX = 64;

/**
 * A fresh SecretStorage id for a provider's key. Obsidian rejects ids that are not lowercase
 * letters, digits and dashes, or longer than 64 characters, so the provider id is folded into
 * that alphabet and shortened; the UUID alone keeps ids unique.
 */
export function providerSecretId(providerId: string): string {
  const suffix = crypto.randomUUID().toLowerCase();
  const room = SECRET_ID_MAX - SECRET_ID_PREFIX.length - suffix.length - 1;
  const slug = providerId.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, room).replace(/^-+|-+$/g, "");
  return `${SECRET_ID_PREFIX}${slug ? `${slug}-` : ""}${suffix}`;
}

export function newProvider(presetId: string, existing: ProviderConfig[]): ProviderConfig {
  const preset = API_PROVIDERS[presetId] ?? API_PROVIDERS.custom!;
  const taken = new Set(existing.map((item) => item.id));
  let id = presetId === "custom" ? `custom-${crypto.randomUUID().slice(0, 8)}` : presetId;
  for (let n = 2; taken.has(id); n++) id = `${presetId}-${n}`;
  return { id, provider: presetId, baseUrl: preset.baseUrl, protocol: preset.protocol, model: "", secretId: providerSecretId(id) };
}

export function upsertProvider(settings: QiaomuSettings, provider: ProviderConfig): void {
  const index = settings.providers.findIndex((item) => item.id === provider.id);
  const wasActive = index >= 0 && sameEndpoint(settings.providers[index]!, settings.api);
  if (index >= 0) settings.providers[index] = provider; else settings.providers.push(provider);
  if (wasActive || settings.providers.length === 1) settings.api = connectionOf(provider);
}

/** Persist model identity changes and the chat's independent pointers as one recoverable edit. */
export async function persistProviderModelChange(
  settings: QiaomuSettings, provider: ProviderConfig, previousId: string, nextId: string | undefined,
  persist: () => Promise<void>,
): Promise<void> {
  const before = { selections: settings.modelSelections, recent: settings.recentModels };
  const key = apiSelectionKey(provider);
  const selection = settings.modelSelections?.[key];
  const active = activeProvider(settings);
  const ownsSelection = !active || active.id === provider.id || apiSelectionKey(active) !== key;
  const selections = ownsSelection && selection?.model === previousId && nextId !== previousId
    ? { ...settings.modelSelections, [key]: { model: nextId ?? provider.model, effort: "" } }
    : settings.modelSelections;
  const source = `api:${provider.id}`;
  const recent = settings.recentModels.flatMap(item => item.source === source && item.model === previousId
    ? nextId ? [{ ...item, model: nextId }] : [] : [item])
    .filter((item, index, all) => all.findIndex(other => other.source === item.source && other.model === item.model) === index);
  try {
    await persistProviderChange(settings, () => {
      settings.modelSelections = selections;
      settings.recentModels = recent;
      upsertProvider(settings, provider);
      return provider;
    }, persist);
  } catch (error) {
    if (settings.modelSelections === selections) settings.modelSelections = before.selections;
    if (settings.recentModels === recent) settings.recentModels = before.recent;
    throw error;
  }
}

export function removeProvider(settings: QiaomuSettings, id: string): void {
  const removed = findProvider(settings, id);
  settings.providers = settings.providers.filter((item) => item.id !== id);
  if (removed && sameEndpoint(removed, settings.api)) {
    const next = settings.providers[0];
    settings.api = next ? connectionOf(next) : { provider: "openai", baseUrl: API_PROVIDERS.openai!.baseUrl, model: "", secretId: providerSecretId("openai") };
    if (!next && settings.backendKind === "api") settings.backendKind = "auto";
  }
  settings.recentModels = settings.recentModels.filter((item) => item.source !== `api:${id}`);
}

/** Credential deletion belongs after this succeeds; failed disk writes restore the removed source. */
export async function persistProviderRemoval(settings: QiaomuSettings, id: string, persist: () => Promise<void>): Promise<void> {
  const index = settings.providers.findIndex(item => item.id === id);
  const provider = settings.providers[index];
  if (!provider) return;
  const before = { api: settings.api, backend: settings.backendKind, recent: settings.recentModels };
  removeProvider(settings, id);
  const after = { api: settings.api, backend: settings.backendKind, recent: settings.recentModels };
  try { await persist(); }
  catch (error) {
    if (!findProvider(settings, id)) settings.providers.splice(index, 0, provider);
    if (settings.api === after.api) settings.api = before.api;
    if (settings.backendKind === after.backend) settings.backendKind = before.backend;
    if (settings.recentModels === after.recent) settings.recentModels = before.recent;
    throw error;
  }
}

export function rememberRecent(settings: QiaomuSettings, source: string, model: string): void {
  if (!model) return;
  settings.recentModels = [{ source, model }, ...settings.recentModels.filter((item) => !(item.source === source && item.model === model))].slice(0, RECENT_LIMIT);
}

export function apiSelectionKey(connection: ApiConnection): string {
  return `api:${connection.provider}:${connection.baseUrl}`;
}

/**
 * Applies a picker choice: points the chat at the source and records the model.
 * Returns the modelSelections key that now holds the choice.
 */
export function chooseModel(settings: QiaomuSettings, source: string, model: string): string {
  settings.modelSelections ??= {};
  let key: string;
  if (source.startsWith("cli:")) {
    settings.backendKind = "cli";
    settings.preferredCli = source.slice(4);
    key = source;
  } else {
    const provider = findProvider(settings, source.slice(4));
    if (!provider) throw new Error("该服务商已被移除");
    provider.model = model;
    settings.api = connectionOf(provider);
    settings.backendKind = "api";
    key = apiSelectionKey(settings.api);
  }
  const previous = settings.modelSelections[key];
  settings.modelSelections[key] = { model, effort: previous?.model === model ? previous.effort : "" };
  rememberRecent(settings, source, model);
  return key;
}
