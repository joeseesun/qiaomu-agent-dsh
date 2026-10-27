import { describe, expect, it } from "vitest";
import { checkImageInput, compactTokens, reportedCapabilities, resolveModel } from "../src/services/model-capabilities";
import { acpContextUsage, apiContextUsage, codexContextUsage, contextUsage } from "../src/services/context-usage";
import { anthropicHeaders, withBodyExtras } from "../src/services/api-backend";
import { knownTextOnly, knownToThink, thinkingRequest } from "../src/services/thinking";
import { fromStoredMessage, toStoredMessage } from "../src/services/chat-transport";
import { normalizeSettings } from "../src/defaults";

describe("reported model capabilities", () => {
  it("reads OpenRouter's context length, image input and reasoning support", () => {
    expect(reportedCapabilities({ id: "anthropic/claude-sonnet-5", context_length: 1_000_000, architecture: { input_modalities: ["text", "image"] }, supported_parameters: ["tools", "reasoning"] }))
      .toEqual({ contextWindow: 1_000_000, vision: true, reasoning: true });
    expect(reportedCapabilities({ id: "deepseek/deepseek-chat", context_length: 128_000, architecture: { input_modalities: ["text"] }, supported_parameters: ["tools"] }))
      .toEqual({ contextWindow: 128_000, vision: false, reasoning: false });
  });

  it("reads Gemini's input limit and thinking flag", () => {
    expect(reportedCapabilities({ name: "models/gemini-3-pro", inputTokenLimit: 1_048_576, thinking: true })).toEqual({ contextWindow: 1_048_576, reasoning: true });
  });

  it("leaves unstated capabilities unknown", () => {
    expect(reportedCapabilities({ id: "some-model", context_length: -1 })).toEqual({});
  });
});

describe("resolved model", () => {
  const provider = { provider: "openrouter", models: [{ id: "a", name: "A", efforts: [], contextWindow: 200_000, vision: false, reasoning: false }] };

  it("uses what the vendor reported until the user overrides it", () => {
    expect(resolveModel(provider, "a")).toEqual({ contextWindow: 200_000, vision: false, thinking: false, efforts: [] });
    expect(resolveModel({ ...provider, modelOptions: { a: { contextWindow: 64_000, vision: true, reasoning: true } } }, "a"))
      .toEqual({ contextWindow: 64_000, vision: true, thinking: true, efforts: ["low", "medium", "high"] });
  });

  it("keeps built-in effort levels and lets the user switch thinking off", () => {
    expect(resolveModel({ provider: "google" }, "gemini-3-pro").efforts).toEqual(["low", "high"]);
    expect(resolveModel({ provider: "openai", modelOptions: { "gpt-5.5": { reasoning: false } } }, "gpt-5.5").efforts).toEqual([]);
    expect(resolveModel({ provider: "custom" }, "unknown").efforts).toEqual([]);
    expect(resolveModel({ provider: "deepseek", models: [{ id: "deepseek-flash", name: "Flash", reasoning: true, efforts: ["low", "high", "max"] }] }, "deepseek-flash").efforts)
      .toEqual(["none", "low", "high", "max"]);
  });

  it("blocks images only for models known not to read them", () => {
    const image = [{ id: "1", name: "a.png", mediaType: "image/png", size: 1 }];
    expect(() => checkImageInput({ vision: false, efforts: [] }, image)).toThrow("不支持图片输入");
    expect(() => checkImageInput({ efforts: [] }, image)).not.toThrow();
    expect(() => checkImageInput({ vision: false, efforts: [] }, [{ id: "2", name: "a.md", mediaType: "text/markdown", size: 1 }])).not.toThrow();
  });

  it("formats token counts compactly", () => {
    expect([950, 9_500, 53_000, 128_000, 1_048_576].map(compactTokens)).toEqual(["950", "9.5K", "53K", "128K", "1M"]);
  });

  it("keeps valid per-model options and drops malformed ones", () => {
    const settings = normalizeSettings({ providers: [{ id: "x", provider: "openrouter", baseUrl: "https://openrouter.ai/api/v1", model: "a", secretId: "k", enabledModels: ["a"], modelOptions: { a: { contextWindow: 64_000, reasoning: true, vision: "yes" } } }] });
    expect(settings.providers[0]?.modelOptions?.a).toEqual({ contextWindow: 64_000, reasoning: true });
  });
});

describe("context usage", () => {
  it("parses Codex, ACP and API reports and ignores missing window sizes", () => {
    expect(codexContextUsage({ threadId: "t", tokenUsage: { last: { totalTokens: 53_000 }, total: { totalTokens: 90_000 }, modelContextWindow: 200_000 } })).toEqual({ used: 53_000, size: 200_000 });
    expect(codexContextUsage({ tokenUsage: { last: { totalTokens: 10 }, modelContextWindow: null } })).toBeNull();
    expect(acpContextUsage({ sessionUpdate: "usage_update", used: 1_000, size: 8_000 })).toEqual({ used: 1_000, size: 8_000 });
    expect(apiContextUsage({ inputTokens: 900, outputTokens: 100 }, 4_000)).toEqual({ used: 1_000, size: 4_000 });
    expect(apiContextUsage({ inputTokens: 900, outputTokens: 100 }, undefined)).toBeNull();
    expect(contextUsage(Number.NaN, 10)).toBeNull();
  });

  it("survives saving and reloading a conversation", () => {
    const stored = toStoredMessage(fromStoredMessage({ id: "m", role: "assistant", content: "hi", createdAt: 1, usage: { used: 5, size: 10 } }));
    expect(stored.usage).toEqual({ used: 5, size: 10 });
  });
});

describe("thinking switches", () => {
  const relay = { provider: "custom", protocol: "openai-chat" as const };
  it("sends nothing without an effort", () => {
    expect(thinkingRequest(relay, "openai-chat", "glm-5.3", undefined)).toEqual({});
  });

  it("uses the SDK setting where the SDK knows the vendor", () => {
    expect(thinkingRequest({ provider: "openai" }, "openai-chat", "gpt-5.5", "high")).toEqual({ reasoning: "high" });
    expect(thinkingRequest({ provider: "google" }, "google", "gemini-3-pro", "low")).toEqual({ reasoning: "low" });
    expect(thinkingRequest({ provider: "anthropic" }, "anthropic", "claude-sonnet-4-5", "high")).toEqual({ reasoning: "high" });
  });

  it("gives renamed adaptive Claude models adaptive thinking explicitly", () => {
    expect(thinkingRequest({ provider: "custom" }, "anthropic", "anthropic/claude-sonnet-4.6", "medium"))
      .toEqual({ providerOptions: { anthropic: { thinking: { type: "adaptive" }, effort: "medium" } } });
  });

  it("uses OpenRouter's reasoning object, and every common switch for other compatible services", () => {
    expect(thinkingRequest({ provider: "deepseek" }, "openai-chat", "deepseek-flash", "max"))
      .toEqual({ body: { thinking: { type: "enabled" }, reasoning_effort: "max" } });
    expect(thinkingRequest({ provider: "deepseek" }, "openai-chat", "deepseek-flash", "none"))
      .toEqual({ body: { thinking: { type: "disabled" } } });
    expect(thinkingRequest({ provider: "openrouter" }, "openai-chat", "deepseek/deepseek-v4-pro", "high")).toEqual({ body: { reasoning: { effort: "high" } } });
    expect(thinkingRequest(relay, "openai-chat", "qwen3.7-plus", "low").body)
      .toEqual({ thinking: { type: "enabled" }, enable_thinking: true, reasoning_effort: "low", reasoning: { effort: "low" } });
    expect(JSON.parse(withBodyExtras(JSON.stringify({ model: "m" }), { reasoning: { effort: "high" } }) as string)).toEqual({ model: "m", reasoning: { effort: "high" } });
    expect(withBodyExtras("not json", { a: 1 })).toBe("not json");
  });

  it("knows common thinking and text-only models without a vendor list", () => {
    expect(["claude-opus-4.8", "anthropic/claude-sonnet-5", "deepseek-v4-pro", "kimi-k2.6", "glm-5.3", "qwen3.7-plus", "gemini-2.5-pro"].map(knownToThink)).toEqual(Array(7).fill(true));
    expect(["gpt-4o", "llama-3.3-70b", "claude-3-5-haiku"].map(knownToThink)).toEqual([false, false, false]);
    expect(["deepseek-chat", "zai/glm-5.3", "glm-5.2v", "qwen3-vl-plus"].map(knownTextOnly)).toEqual([true, true, false, false]);
    expect(resolveModel({ provider: "deepseek" }, "deepseek-chat")).toMatchObject({ vision: false });
    expect(resolveModel({ provider: "custom" }, "glm-5.3")).toMatchObject({ thinking: true, efforts: ["low", "medium", "high"] });
  });

  it("authenticates Claude relays both ways, Anthropic itself by key only", () => {
    expect(anthropicHeaders("custom", "k")).toMatchObject({ Authorization: "Bearer k" });
    expect(anthropicHeaders("anthropic", "k")).not.toHaveProperty("Authorization");
  });
});

describe("API base URL", () => {
  it("adds the version segment Anthropic-compatible services are often entered without", async () => {
    const { apiBaseUrl } = await import("../src/services/api-providers");
    const anthropic = { provider: "custom", protocol: "anthropic" as const, model: "m", secretId: "s" };
    expect(apiBaseUrl({ ...anthropic, baseUrl: "https://relay.example.com/" })).toBe("https://relay.example.com/v1");
    expect(apiBaseUrl({ ...anthropic, baseUrl: "https://api.anthropic.com/v1" })).toBe("https://api.anthropic.com/v1");
    expect(apiBaseUrl({ ...anthropic, baseUrl: "https://relay.example.com/claude/v1" })).toBe("https://relay.example.com/claude/v1");
    expect(apiBaseUrl({ ...anthropic, baseUrl: "https://open.bigmodel.cn/api/anthropic" })).toBe("https://open.bigmodel.cn/api/anthropic/v1");
    // OpenAI-compatible: a bare origin gets /v1, a relay's own prefix is kept, doubled versions collapse.
    const openai = { ...anthropic, protocol: "openai-chat" as const };
    expect(apiBaseUrl({ ...openai, baseUrl: "https://relay.example.com" })).toBe("https://relay.example.com/v1");
    expect(apiBaseUrl({ ...openai, baseUrl: "https://relay.example.com/openai" })).toBe("https://relay.example.com/openai");
    expect(apiBaseUrl({ ...openai, baseUrl: "https://relay.example.com/v1/v1" })).toBe("https://relay.example.com/v1");
    expect(apiBaseUrl({ ...openai, baseUrl: "https://ark.cn-beijing.volces.com/api/v3" })).toBe("https://ark.cn-beijing.volces.com/api/v3");
  });
});
