import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch, apiStatusError, nativeApiFetch, connectionError, type NativeNet } from "../src/services/api-transport";

function network() {
  const req = Object.assign(new EventEmitter(), { setHeader: vi.fn(), write: vi.fn(), end: vi.fn(), abort: vi.fn() });
  const net: NativeNet = { request: vi.fn(() => req) };
  const res = Object.assign(new EventEmitter(), { statusCode: 200, headers: { "content-type": "text/event-stream" } });
  return { req, net, res };
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("native model API transport", () => {
  it("delivers bytes before the server finishes and preserves split UTF-8", async () => {
    const { req, net, res } = network();
    const pending = nativeApiFetch(net, "https://example.com/v1/chat/completions", { method: "POST", headers: { Authorization: "Bearer test" }, body: "{}" });
    req.emit("response", res);
    const response = await pending;
    const reader = response.body!.getReader();
    const bytes = new TextEncoder().encode("中文");
    res.emit("data", bytes.slice(0, 2));
    expect((await reader.read()).value).toEqual(bytes.slice(0, 2));
    res.emit("data", bytes.slice(2));
    expect((await reader.read()).value).toEqual(bytes.slice(2));
    res.emit("end");
    expect((await reader.read()).done).toBe(true);
    expect(net.request).toHaveBeenCalledWith(expect.objectContaining({ redirect: "manual", useSessionCookies: false }));
    expect(req.write).toHaveBeenCalledWith("{}");
  });
  it("rejects malformed native response metadata instead of hanging", async () => {
    const { req, net, res } = network(); res.statusCode = 999;
    const pending = nativeApiFetch(net, "https://example.com", {});
    req.emit("response", res);
    await expect(pending).rejects.toThrow("有效"); expect(req.abort).toHaveBeenCalledOnce();
  });
  it("registers end before data starts flowing across Electron remote", async () => {
    const { req, net, res } = network();
    const original = res.on.bind(res);
    res.on = ((event: string, callback: (...args: any[]) => void) => {
      original(event, callback);
      if (event === "data") { res.emit("data", new TextEncoder().encode("OK")); res.emit("end"); }
      return res;
    }) as typeof res.on;
    const pending = nativeApiFetch(net, "https://example.com", {});
    req.emit("response", res);
    expect(await (await pending).text()).toBe("OK");
  });
  it("aborts before headers without replay", async () => {
    const { req, net } = network(); const controller = new AbortController();
    const promise = nativeApiFetch(net, "https://example.com", { signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(req.abort).toHaveBeenCalledOnce();
    expect(net.request).toHaveBeenCalledOnce();
  });
  it("aborts the native socket after headers and errors the reader", async () => {
    const { req, net, res } = network(); const controller = new AbortController();
    const pending = nativeApiFetch(net, "https://example.com", { signal: controller.signal });
    req.emit("response", res); const response = await pending;
    const reader = response.body!.getReader(); const read = reader.read();
    controller.abort();
    await expect(read).rejects.toMatchObject({ name: "AbortError" });
    expect(req.abort).toHaveBeenCalledOnce();
    res.emit("end"); res.emit("data", new Uint8Array([1]));
  });
  it("does not forward credentials through redirects", async () => {
    const { req, net } = network();
    const promise = nativeApiFetch(net, "https://example.com", { headers: { Authorization: "Bearer test" } });
    req.emit("redirect", 302, "GET", "https://other.example.com");
    await expect(promise).rejects.toThrow("跳转"); expect(req.abort).toHaveBeenCalledOnce();
  });
  it("times out a stalled connection and cleans up", async () => {
    vi.useFakeTimers(); const { req, net } = network();
    const promise = nativeApiFetch(net, "https://example.com", {});
    const assertion = expect(promise).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(60_000); await assertion;
    expect(req.abort).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
  it("cancels the underlying request when a stream is discarded", async () => {
    const { req, net, res } = network(); const pending = nativeApiFetch(net, "https://example.com", {});
    req.emit("response", res); await (await pending).body!.cancel();
    expect(req.abort).toHaveBeenCalledOnce();
  });
});
describe("buffered host fallback and actionable errors", () => {
  it("recognizes Cloudflare challenges without exposing HTML or keys", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("<html>private</html>", { status: 403, headers: { "cf-mitigated": "challenge", "content-type": "text/html" } }));
    vi.stubGlobal("fetch", fetcher);
    await expect(apiFetch("https://example.com", { headers: { Authorization: "Bearer test", Origin: "app://obsidian.md" } })).rejects.toThrow("Cloudflare");
    const headers = new Headers(fetcher.mock.calls[0]![1].headers);
    expect(headers.has("origin")).toBe(false); expect(headers.get("user-agent")).toBe("QiaomuAgent/1.0");
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("returns promptly when the buffered host request is cancelled", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    const controller = new AbortController(); const pending = apiFetch("https://example.com", { signal: controller.signal });
    controller.abort(); await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("keeps HTTP 403 distinct from invalid keys and redacts secret text", () => {
    expect(apiStatusError(403).message).toContain("访问规则");
    expect(apiStatusError(401).message).toContain("密钥");
    expect(apiStatusError(429).message).toContain("额度");
    expect(connectionError(new TypeError("Failed to fetch"))).toContain("代理");
    expect(connectionError(new Error("bad sk-super-secret"))).not.toContain("sk-super-secret");
  });
});


describe("private HTTP request authorization", () => {
  it("sends only to the explicitly approved private origin", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{"data":[]}'));
    vi.stubGlobal("fetch", fetcher);
    const approved = "http://192.168.1.20:8000/v1";
    await expect(apiFetch(`${approved}/models`)).rejects.toThrow();
    await expect(apiFetch("http://192.168.1.21:8000/v1/models", {}, approved)).rejects.toThrow();
    await expect(apiFetch("http://192.168.1.20:8001/v1/models", {}, approved)).rejects.toThrow();
    await expect(apiFetch("http://fda.gov/v1/models", {}, "http://fda.gov/v1")).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    expect((await apiFetch(`${approved}/models`, {}, approved)).status).toBe(200);
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
