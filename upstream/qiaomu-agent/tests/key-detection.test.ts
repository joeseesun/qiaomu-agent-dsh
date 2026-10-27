import { describe, expect, it } from "vitest";
import { detectKey, isChatModel, recommendedModels } from "../src/services/key-detection";
import { API_PROVIDERS } from "../src/services/api-providers";

const m = (...ids: string[]) => ids.map((id) => ({ id, name: id, efforts: [] }));

describe("API key detection", () => {
  it.each([
    ["sk-ant-api03-abcdef", "anthropic"],
    ["sk-or-v1-0123456789", "openrouter"],
    ["AIzaSyA-0123456789abcdef", "google"],
    ["gsk_0123456789abcdef", "groq"],
    ["xai-0123456789abcdef", "xai"],
    ["pplx-0123456789abcdef", "perplexity"],
    ["csk-0123456789abcdef", "cerebras"],
    ["fw_0123456789abcdef", "fireworks"],
    ["sk-proj-0123456789abcdef", "openai"],
    ["sk-svcacct-0123456789", "openai"],
    ["  sk-ant-api03-trimmed  ", "anthropic"],
  ])("recognises %s as %s", (key, provider) => {
    expect(detectKey(key)).toEqual({ kind: "unique", provider });
  });

  it("never guesses a single vendor for shared key shapes", () => {
    expect(detectKey("sk-" + "0123456789abcdef".repeat(2))).toEqual({ kind: "ambiguous", candidates: ["deepseek", "qwen", "qwen-intl", "mimo"] });
    expect(detectKey("sk-" + "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUV")).toMatchObject({ kind: "ambiguous", candidates: expect.arrayContaining(["moonshot"]) });
    expect(detectKey("sk-" + "a".repeat(48))).toMatchObject({ kind: "ambiguous", candidates: ["siliconflow", "moonshot", "openai"] });
    expect(detectKey("0123456789abcdef0123456789abcdef.AbCdEfGhIjKlMnOp")).toEqual({ kind: "ambiguous", candidates: ["glm", "zai"] });
    expect(detectKey("3f2b1c4d-1111-2222-3333-444455556666")).toEqual({ kind: "ambiguous", candidates: ["doubao"] });
    expect(detectKey("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig")).toEqual({ kind: "ambiguous", candidates: ["minimax"] });
    expect(detectKey("AQ.0123456789abcdefghijklmnop")).toEqual({ kind: "ambiguous", candidates: ["google"] });
    expect(detectKey("sk-short")).toMatchObject({ kind: "ambiguous" });
    expect(detectKey("whatever-key")).toMatchObject({ kind: "ambiguous" });
    expect(detectKey("   ")).toEqual({ kind: "empty" });
  });

  it("only suggests providers that exist in the catalog", () => {
    const samples = ["sk-" + "0".repeat(32), "sk-" + "A".repeat(48), "sk-x", "0".repeat(32) + ".AbCdEfGhIjKlMnOp", "3f2b1c4d-1111-2222-3333-444455556666", "eyJa.b.c", "0".repeat(64), "A".repeat(32), "??"];
    for (const sample of samples) {
      const result = detectKey(sample);
      if (result.kind === "ambiguous") for (const id of result.candidates) expect(API_PROVIDERS[id], `${sample} → ${id}`).toBeDefined();
    }
  });
});

describe("recommended models", () => {
  it("picks one model per preferred family, newest first, skipping non-chat models", () => {
    expect(recommendedModels("anthropic", m("claude-haiku-4-5", "claude-opus-5-5", "claude-opus-4-1", "claude-sonnet-5", "claude-sonnet-4-5")))
      .toEqual(["claude-opus-5-5", "claude-sonnet-5", "claude-haiku-4-5"]);
    expect(recommendedModels("deepseek", m("deepseek-chat", "deepseek-reasoner"))).toEqual(["deepseek-chat", "deepseek-reasoner"]);
    expect(recommendedModels("deepseek", m("deepseek-v4-flash", "deepseek-v4-pro", "deepseek-flash")))
      .toEqual(["deepseek-flash", "deepseek-v4-pro", "deepseek-v4-flash"]);
    expect(recommendedModels("openai", m("text-embedding-3-large", "gpt-5", "gpt-5-mini", "whisper-1", "tts-1", "gpt-6-astra"))).toEqual(["gpt-6-astra", "gpt-5", "gpt-5-mini"]);
  });

  it("skips speech and image models and only labels rule matches when padding is off", () => {
    const stepfun = m("step-asr", "step-1o-turbo-vision", "step-2x-large", "step-1x-medium", "step-tts-mini", "step-1o-audio", "step-3", "step-5-preview");
    expect(recommendedModels("stepfun", stepfun)).toEqual(["step-5-preview", "step-1o-turbo-vision", "step-3"]);
    expect(recommendedModels("stepfun", stepfun, 3, { pad: false })).toEqual(["step-5-preview", "step-1o-turbo-vision"]);
    expect(recommendedModels("unknown", m("a", "b"), 3, { pad: false })).toEqual([]);
    expect(["step-asr", "stepaudio-2.5-asr", "step-tts-mini", "step-2x-large", "stepaudio-3-music-preview"].filter(isChatModel)).toEqual([]);
    expect(["step-5-preview", "step-3.7-flash", "gpt-6-astra", "kimi-k3", "fastr-1"].every(isChatModel)).toBe(true);
  });

  it("falls back to the first chat models and honours a vendor default", () => {
    expect(recommendedModels("unknown", m("embed-x", "a", "b", "c", "d"))).toEqual(["a", "b", "c"]);
    expect(recommendedModels("moonshot", [{ id: "moonshot-v1-8k", name: "", efforts: [], isDefault: true }, ...m("kimi-k3")])).toEqual(["moonshot-v1-8k", "kimi-k3"]);
    expect(recommendedModels("glm", [])).toEqual([]);
  });
});
