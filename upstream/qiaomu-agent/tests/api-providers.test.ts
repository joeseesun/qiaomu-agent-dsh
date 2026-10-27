import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../src/defaults";
import { API_PROVIDERS, apiBaseUrl, apiProtocol, permitsEmptyKey, validateApiUrl } from "../src/services/api-providers";

describe("API provider configuration", () => {
  it("covers requested providers with valid endpoints", () => {
    for (const id of ["openrouter", "siliconflow", "stepfun", "mimo"]) expect(API_PROVIDERS[id]).toBeDefined();
    for (const [id, preset] of Object.entries(API_PROVIDERS)) {
      if (id !== "custom") expect(validateApiUrl(preset.baseUrl)).toBe(preset.baseUrl);
    }
  });
  it("normalizes pasted request URLs and repeated v1 without changing relay prefixes", () => {
    for (const suffix of ["/chat/completions", "/responses", "/messages", "/models", "/v1"]) {
      expect(apiBaseUrl({ ...DEFAULT_SETTINGS.api, provider: "custom", protocol: "openai-chat", baseUrl: `https://example.com/api/v1${suffix}` })).toBe("https://example.com/api/v1");
    }
    expect(apiBaseUrl({ ...DEFAULT_SETTINGS.api, baseUrl: "https://example.com/proxy" })).toBe("https://example.com/proxy");
  });
  it("uses native protocols for existing configs and explicit overrides", () => {
    expect(apiProtocol({ ...DEFAULT_SETTINGS.api, provider: "anthropic" })).toBe("anthropic");
    expect(apiProtocol({ ...DEFAULT_SETTINGS.api, provider: "custom", protocol: "google" })).toBe("google");
    expect(apiProtocol({ ...DEFAULT_SETTINGS.api, protocol: "openai-responses" })).toBe("openai-responses");
  });
  it("only allows keyless connections to explicit local presets", () => {
    const connection = { ...DEFAULT_SETTINGS.api, provider: "ollama", baseUrl: "http://localhost:11434/v1" };
    expect(permitsEmptyKey(connection)).toBe(true);
    expect(permitsEmptyKey({ ...connection, baseUrl: "https://example.com/v1" })).toBe(false);
    expect(permitsEmptyKey({ ...connection, provider: "custom" })).toBe(false);
  });
  it.each(["http://example.com/v1", "https://user:secret@example.com/v1", "https://example.com/v1?key=secret", "file:///tmp/api", "https://example.com/#secret"])("rejects unsafe endpoint %s", (url) => {
    expect(() => validateApiUrl(url)).toThrow();
  });
  it("rejects private HTTP by default without confirmation", () => {
    expect(() => validateApiUrl("http://172.16.92.211:23323/v1")).toThrow("局域网私有地址请确认允许使用 HTTP 连接");
    expect(() => validateApiUrl("http://192.168.1.100:8000/v1")).toThrow("局域网私有地址请确认允许使用 HTTP 连接");
  });
  it("allows private HTTP when explicitly confirmed", () => {
    expect(validateApiUrl("http://172.16.92.211:23323/v1", true)).toBe("http://172.16.92.211:23323/v1");
    expect(validateApiUrl("http://192.168.1.100:8000/v1/", { allowPrivateHttp: true })).toBe("http://192.168.1.100:8000/v1");
    expect(validateApiUrl("http://10.0.0.2:11434/v1", true)).toBe("http://10.0.0.2:11434/v1");
  });
  it("still rejects public remote HTTP even when private HTTP is allowed", () => {
    expect(() => validateApiUrl("http://example.com/v1", true)).toThrow();
    expect(() => validateApiUrl("http://8.8.8.8/v1", true)).toThrow();
  });
  it("normalizes apiBaseUrl with configured private HTTP endpoints", () => {
    expect(apiBaseUrl({ ...DEFAULT_SETTINGS.api, provider: "custom", baseUrl: "http://172.16.92.211:23323/v1", privateHttpApprovedUrl: "http://172.16.92.211:23323/v1" })).toBe("http://172.16.92.211:23323/v1");
  });
});
