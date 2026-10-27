import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, normalizeSettings } from "../src/defaults";
import { activeProvider, agentShown, chooseModel, addProviderConnection, persistProviderChange, persistProviderRemoval, DEFAULT_VISIBLE_AGENT_IDS, exposedModels, maskKey, migrateProviders, newProvider, providerSecretId, removeProvider, upsertProvider, visibleAgentModels } from "../src/services/model-sources";
import type { QiaomuSettings } from "../src/types";

function fresh(): QiaomuSettings {
  return structuredClone(DEFAULT_SETTINGS);
}

describe("model providers", () => {
  it("shows every discovered agent by default while keeping Pi's catalog opt-in", () => {
    const settings = normalizeSettings({});
    expect(DEFAULT_VISIBLE_AGENT_IDS).toHaveLength(7);
    expect(agentShown(settings, "codex")).toBe(true);
    expect(agentShown(settings, "grok")).toBe(true);
    expect(visibleAgentModels(settings, "pi", [{ id: "anthropic/claude", name: "Claude", efforts: [] }]).models).toEqual([]);
    settings.agentVisibility.grok = false;
    expect(agentShown(normalizeSettings(settings), "grok")).toBe(false);
  });
  it("migrates the old single connection and per-provider profiles into a list", () => {
    const settings = normalizeSettings({
      api: { provider: "deepseek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat", secretId: "s-deepseek" },
      apiProfiles: { mimo: { provider: "mimo", baseUrl: "https://api.xiaomimimo.com/v1", model: "", secretId: "s-mimo" }, deepseek: { provider: "deepseek", baseUrl: "https://api.deepseek.com/v1", model: "old", secretId: "s-deepseek" } },
    });
    expect(settings.providers.map((p) => p.id)).toEqual(["mimo", "deepseek"]);
    expect(activeProvider(settings)?.id).toBe("deepseek");
    expect(normalizeSettings({}).providers).toEqual([]);
    expect(migrateProviders({ providers: [{ id: "x", provider: "openai", secretId: "k", baseUrl: "u", model: "m" }] }, DEFAULT_SETTINGS.api)).toHaveLength(1);
  });

  it("masks keys without revealing more than eight characters", () => {
    expect(maskKey("sk-abcdefghijklmn1234")).toBe("sk-a…1234");
    expect(maskKey("short")).toBe("••••");
    expect(maskKey("")).toBe("");
  });

  it("exposes only enabled models, including manually added IDs", () => {
    const provider = { ...newProvider("deepseek", []), model: "manual", models: [{ id: "a", name: "A", efforts: [] }, { id: "b", name: "B", efforts: [] }] };
    expect(exposedModels(provider).map((m) => m.id)).toEqual([]);
    expect(exposedModels({ ...provider, enabledModels: ["b", "typed"] }).map((m) => m.id)).toEqual(["b", "typed"]);
  });

  it("keeps per-agent visibility and manual IDs after reload", () => {
    const settings = normalizeSettings({ agentEnabledModels: { kimi: ["", "k3"] }, agentCustomModels: { kimi: ["custom-x"] } });
    const listed = visibleAgentModels(settings, "kimi", [{ id: "k3", name: "K3", efforts: [] }, { id: "k2", name: "K2", efforts: [] }]);
    expect(listed.models.map((model) => model.id)).toEqual(["k3"]);
    expect(listed.showDefault).toBe(true);
    settings.agentEnabledModels.kimi = ["custom-x"];
    expect(visibleAgentModels(settings, "kimi", []).models.map((model) => model.id)).toEqual(["custom-x"]);
    expect(visibleAgentModels(settings, "kimi", []).showDefault).toBe(false);
  });

  it("gives never-curated migrated providers their recommended models", () => {
    const settings = normalizeSettings({ providers: [{ id: "deepseek", provider: "deepseek", baseUrl: "https://api.deepseek.com/v1", model: "", secretId: "s",
      models: [{ id: "deepseek-chat", name: "c", efforts: [] }, { id: "deepseek-reasoner", name: "r", efforts: [] }] }] });
    expect(settings.providers[0]!.enabledModels).toEqual(["deepseek-chat", "deepseek-reasoner"]);
  });

  it("keeps an explicitly empty model list and per-model options after reload", () => {
    const provider = { ...newProvider("deepseek", []), enabledModels: [], showInPicker: false,
      modelOptions: { "deepseek-chat": { temperature: 0.7, maxOutputTokens: 4096 } } };
    const restored = normalizeSettings({ providers: [provider] }).providers[0]!;
    expect(restored.enabledModels).toEqual([]);
    expect(restored.showInPicker).toBe(false);
    expect(restored.modelOptions?.["deepseek-chat"]).toEqual({ temperature: 0.7, maxOutputTokens: 4096 });
  });

  it("restores model picker visibility and readable chat typography settings", () => {
    const settings = normalizeSettings({ hiddenAgents: ["codex"], chatFontFamily: "obsidian", chatFontSize: 18, codeFontSize: 15 });
    expect(settings.hiddenAgents).toEqual(["codex"]);
    expect(settings.chatFontFamily).toBe("obsidian");
    expect(settings.chatFontSize).toBe(18);
    expect(settings.codeFontSize).toBe(15);
    expect(normalizeSettings({ chatFontSize: 99, codeFontSize: 3 }).chatFontSize).toBe(15);
  });

  it("saves independent connections without fetching or silently enabling models", () => {
    const settings = fresh(); const secrets = new Map<string, string>();
    const write = (id: string, key: string) => { secrets.set(id, key); };
    const first = addProviderConnection(settings, "custom", " key-one ", write, { baseUrl: "https://example.com/v1", name: "First" });
    const second = addProviderConnection(settings, "custom", "key-two", write, { baseUrl: "https://example.com/v1", name: "Second" });
    expect(settings.providers).toHaveLength(2);
    expect(first.secretId).not.toBe(second.secretId);
    expect(secrets.get(first.secretId)).toBe("key-one");
    expect(first.enabledModels).toEqual([]);
    expect(first.fetchedAt).toBeUndefined();
    expect(first.model).toBe("");
  });
  it("validates local fields before saving credentials", () => {
    const settings = fresh(); const write = vi.fn();
    expect(() => addProviderConnection(settings, "custom", "", write, { baseUrl: "https://example.com" })).toThrow("API Key");
    expect(() => addProviderConnection(settings, "custom", "key", write, { baseUrl: "http://example.com" })).toThrow("HTTPS");
    expect(settings.providers).toEqual([]); expect(write).not.toHaveBeenCalled();
  });

  it("builds secret ids Obsidian's SecretStorage accepts for every provider", async () => {
    // Obsidian throws for ids that are not lowercase letters, digits and dashes, or longer than 64 characters.
    const valid = /^[a-z0-9-]{1,64}$/;
    expect(newProvider("custom", []).secretId).toMatch(valid);
    for (const id of ["custom-1a2b3c4d", "siliconflow-12", "My_Gateway.v2 (Beta)", "一个很长的中文名字", ""]) {
      expect(providerSecretId(id)).toMatch(valid);
      expect(providerSecretId(id)).not.toMatch(/--/);
    }
    expect(providerSecretId("custom-1a2b3c4d")).not.toBe(providerSecretId("custom-1a2b3c4d"));

    const settings = fresh();
    const secrets = new Map<string, string>();
    const deps = {
      listModels: async () => [{ id: "Qwen/Qwen3-Coder", name: "Qwen", efforts: [] }],
      getSecret: (id: string) => secrets.get(id) ?? null,
      setSecret: (id: string, value: string) => { if (!valid.test(id)) throw new Error("密钥 ID 无效"); secrets.set(id, value); },
    };
    const provider = addProviderConnection(settings, "custom", "sk-AbC_123.XyZ", deps.setSecret, { baseUrl: "https://api.example.com", protocol: "anthropic", name: "test" });
    expect(secrets.get(provider.secretId)).toBe("sk-AbC_123.XyZ");
    addProviderConnection(settings, "custom", "sk-New-KEY", deps.setSecret, { baseUrl: "https://api.example.com" });
    expect(secrets.get(settings.providers[0]!.secretId)).toBe("sk-AbC_123.XyZ");
    expect(secrets.get(settings.providers[1]!.secretId)).toBe("sk-New-KEY");
  });

  it("gives duplicate presets unique ids and isolated secrets", () => {
    const first = newProvider("openrouter", []);
    const second = newProvider("openrouter", [first]);
    expect(second.id).toBe("openrouter-2");
    expect(second.secretId).not.toBe(first.secretId);
    expect(newProvider("custom", []).id).toMatch(/^custom-/);
  });

  it("choosing a model switches the source and remembers it", () => {
    const settings = fresh();
    upsertProvider(settings, { ...newProvider("deepseek", []), model: "deepseek-chat" });
    upsertProvider(settings, newProvider("moonshot", settings.providers));
    chooseModel(settings, "api:moonshot", "kimi-k3");
    expect(settings.backendKind).toBe("api");
    expect(settings.api.provider).toBe("moonshot");
    expect(settings.api.model).toBe("kimi-k3");
    chooseModel(settings, "cli:codex", "gpt-6");
    expect(settings.backendKind).toBe("cli");
    expect(settings.preferredCli).toBe("codex");
    expect(settings.modelSelections?.["cli:codex"]?.model).toBe("gpt-6");
    expect(settings.recentModels).toEqual([{ source: "cli:codex", model: "gpt-6" }, { source: "api:moonshot", model: "kimi-k3" }]);
    chooseModel(settings, "api:moonshot", "kimi-k3");
    expect(settings.recentModels[0]).toEqual({ source: "api:moonshot", model: "kimi-k3" });
    expect(settings.recentModels).toHaveLength(2);
  });

  it("removing the active provider falls back to another and forgets its recents", () => {
    const settings = fresh();
    upsertProvider(settings, newProvider("deepseek", []));
    upsertProvider(settings, newProvider("moonshot", settings.providers));
    chooseModel(settings, "api:moonshot", "kimi-k3");
    removeProvider(settings, "moonshot");
    expect(settings.api.provider).toBe("deepseek");
    expect(settings.recentModels).toEqual([]);
    removeProvider(settings, "deepseek");
    expect(settings.providers).toEqual([]);
    expect(settings.backendKind).toBe("auto");
    expect(() => chooseModel(settings, "api:deepseek", "x")).toThrow("已被移除");
  });
});


describe("failed provider persistence", () => {
  it("rolls back a new provider and active pointer when storage fails", async () => {
    const settings = fresh(); const api = settings.api;
    await expect(persistProviderChange(settings, () => addProviderConnection(settings, "openai", "dummy", () => {}), async () => { throw new Error("disk full"); })).rejects.toThrow("disk full");
    expect(settings.providers).toEqual([]); expect(settings.api).toBe(api);
  });
  it("restores edited settings without discarding another provider's change", async () => {
    const settings = fresh();
    const old = addProviderConnection(settings, "openai", "dummy", () => {});
    const api = settings.api;
    await expect(persistProviderChange(settings, () => { const next = { ...old, model: "new" }; upsertProvider(settings, next); return next; }, async () => {
      addProviderConnection(settings, "anthropic", "dummy", () => {}); throw new Error("disk full");
    })).rejects.toThrow("disk full");
    expect(settings.providers[0]).toBe(old); expect(settings.providers).toHaveLength(2); expect(settings.api).toBe(api);
  });
});


it("restores a removed active subscription and recent models if disk persistence fails", async () => {
  const settings = fresh();
  const provider = addProviderConnection(settings, "chatgpt", "credential-fixture", () => {});
  chooseModel(settings, `api:${provider.id}`, "test");
  const before = { api: settings.api, recent: settings.recentModels, backend: settings.backendKind };
  await expect(persistProviderRemoval(settings, provider.id, async () => { throw new Error("disk full"); })).rejects.toThrow("disk full");
  expect(settings.providers[0]?.id).toBe(provider.id);
  expect(settings.api).toBe(before.api); expect(settings.recentModels).toBe(before.recent); expect(settings.backendKind).toBe(before.backend);
});
