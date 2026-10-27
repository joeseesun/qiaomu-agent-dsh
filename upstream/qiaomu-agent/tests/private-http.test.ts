import { describe, expect, it, vi } from "vitest";
import { normalizeSettings } from "../src/defaults";
import { addProviderConnection, chooseModel } from "../src/services/model-sources";
import { apiBaseUrl, validateApiUrl } from "../src/services/api-providers";
import { isPrivateNetworkHost } from "../src/services/network-hosts";
import { saveMcpServer } from "../src/services/mcp-config";

const baseUrl = "http://192.168.1.20:8000/v1";
describe("private HTTP consent boundaries", () => {
  it.each(["fda.gov", "fc.example.com", "feature.example.com", "february.example.com", "fd00:not-an-ip"])("does not mistake %s for an IPv6 address", (host) => {
    expect(isPrivateNetworkHost(host)).toBe(false);
    expect(() => validateApiUrl(`http://${host}/v1`, true)).toThrow();
  });
  it("saves a confirmed private connection through the real settings helper and survives reload", () => {
    const settings = normalizeSettings({}); const write = vi.fn();
    const provider = addProviderConnection(settings, "custom", "fixture-key", write, { baseUrl, privateHttpApprovedUrl: baseUrl });
    const restored = normalizeSettings(JSON.parse(JSON.stringify(settings)));
    expect(apiBaseUrl(restored.providers[0]!)).toBe(baseUrl);
    chooseModel(restored, `api:${provider.id}`, "fixture");
    expect(apiBaseUrl(restored.api)).toBe(baseUrl);
    expect(write).toHaveBeenCalledOnce();
  });
  it("does not write keys or settings for unconfirmed private endpoints", () => {
    const settings = normalizeSettings({}); const write = vi.fn();
    expect(() => addProviderConnection(settings, "custom", "fixture-key", write, { baseUrl })).toThrow();
    expect(settings.providers).toHaveLength(0); expect(write).not.toHaveBeenCalled();
  });
  it("binds saved consent to the exact endpoint before a request", () => {
    const connection = { ...normalizeSettings({}).api, provider: "custom", baseUrl };
    expect(() => apiBaseUrl(connection)).toThrow();
    expect(() => apiBaseUrl({ ...connection, privateHttpApprovedUrl: "http://192.168.1.21:8000/v1" })).toThrow();
  });
  it("requires MCP private HTTP confirmation before changing configuration", () => {
    expect(() => saveMcpServer("{}", { name: "lan", kind: "http", target: baseUrl, args: [] })).toThrow();
  });
});
