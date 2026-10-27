import { requestUrl } from "obsidian";
import { getRuntimeRequire } from "./runtime-require";
import { connectionText as t } from "../i18n/connection";
import { isLocalHost, isPrivateHttpUrl } from "./network-hosts";

type Listener = (...args: any[]) => void;
export interface NativeRequest {
  on(event: string, listener: Listener): unknown;
  setHeader(name: string, value: string): void;
  write(body: string | Uint8Array): void;
  end(): void;
  abort(): void;
}
export interface NativeNet { request(options: { url: string; method: string; redirect: string; useSessionCookies: boolean }): NativeRequest }

function nativeNet(): NativeNet | null {
  const require = getRuntimeRequire();
  if (!require) return null;
  try {
    const electron = require("electron") as { net?: NativeNet; remote?: { net?: NativeNet } };
    return electron.net ?? electron.remote?.net ?? null;
  } catch { return null; }
}

/** Chromium's native stack retains system proxy support and streams without renderer CORS. */
export function nativeApiFetch(net: NativeNet, url: string, init: RequestInit): Promise<Response> {
  return new Promise((resolve, reject) => {
    const signal = init.signal;
    if (signal?.aborted) { reject(signal.reason); return; }
    const req = net.request({ url, method: init.method ?? "GET", redirect: "manual", useSessionCookies: false });
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    let done = false;
    const cleanup = () => { signal?.removeEventListener("abort", abort); clearTimeout(timer); };
    const fail = (error: unknown) => {
      if (done) return;
      done = true; cleanup();
      controller?.error(error);
      reject(error);
      req.abort();
    };
    const abort = () => fail(signal?.reason ?? new DOMException(t("cancelled"), "AbortError"));
    // Bound connection / inactivity, not the total duration of an active stream.
    let timer = setTimeout(() => fail(new DOMException(t("timeout"), "TimeoutError")), 60_000);
    const tick = () => { clearTimeout(timer); timer = setTimeout(() => fail(new DOMException(t("timeout"), "TimeoutError")), 60_000); };
    signal?.addEventListener("abort", abort, { once: true });
    req.on("redirect", () => fail(new Error(t("redirect"))));
    req.on("error", () => fail(new Error(t("network"))));
    req.on("response", (res: { statusCode: number; headers: Record<string, string | string[]>; on: (event: string, cb: Listener) => void }) => {
      if (done) return;
      if (res.statusCode >= 300 && res.statusCode < 400) { fail(new Error(t("redirect"))); return; }
      try {
      tick();
      const headers = new Headers();
      for (const [key, value] of Object.entries(res.headers)) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
      const body = new ReadableStream<Uint8Array>({
        start(c) { controller = c; },
        cancel() { if (!done) { done = true; cleanup(); req.abort(); } },
      });
      res.on("end", () => { if (!done) { done = true; cleanup(); controller!.close(); } });
      res.on("error", () => fail(new Error(t("network"))));
      res.on("aborted", () => fail(new Error(t("network"))));
      res.on("close", () => { if (!done) fail(new Error(t("network"))); });
      // Register completion before data: remote Electron streams may start flowing immediately.
      res.on("data", (chunk: Uint8Array) => { if (!done) { tick(); controller!.enqueue(new Uint8Array(chunk)); } });
      resolve(new Response([204, 205, 304].includes(res.statusCode) ? null : body, { status: res.statusCode, headers }));
      } catch { fail(new Error(t("invalidResponse"))); }
    });
    try {
      new Headers(init.headers).forEach((value, key) => req.setHeader(key, value));
      if (typeof init.body === "string") req.write(init.body);
      else if (init.body) throw new Error("Unsupported API request body");
      req.end();
    } catch (error) { fail(error); }
  });
}

/** Mobile/older-host fallback: CORS-free, buffered SSE; no automatic replay of paid POST requests. */
async function bufferedApiFetch(url: string, init: RequestInit): Promise<Response> {
  const signal = init.signal;
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    let settled = false;
    const abort = () => { settled = true; cleanup(); reject(signal?.reason ?? new DOMException(t("cancelled"), "AbortError")); };
    const timer = setTimeout(() => { settled = true; cleanup(); reject(new DOMException(t("timeout"), "TimeoutError")); }, 120_000);
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); };
    signal?.addEventListener("abort", abort, { once: true });
    void Promise.resolve().then(() => {
      signal?.throwIfAborted();
      return requestUrl({
      url, method: init.method ?? "GET", headers: Object.fromEntries(new Headers(init.headers)),
      ...(typeof init.body === "string" ? { body: init.body } : {}), throw: false,
      });
    }).then((res) => {
      if (settled) return;
      cleanup();
      resolve(new Response([204, 205, 304].includes(res.status) ? null : res.arrayBuffer, { status: res.status, headers: res.headers }));
    }).catch(() => { cleanup(); if (!settled) reject(signal?.aborted ? signal.reason : new Error(t("network"))); });
  });
}

export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}, privateHttpApprovedUrl?: string): Promise<Response> {
  const request = input instanceof Request ? input : null;
  const url = new URL(request?.url ?? String(input));
  let approvedPrivateOrigin = false;
  try { approvedPrivateOrigin = Boolean(privateHttpApprovedUrl && isPrivateHttpUrl(privateHttpApprovedUrl) && new URL(privateHttpApprovedUrl).origin === url.origin); } catch { /* invalid approval is not consent */ }
  if (url.username || url.password || (url.protocol !== "https:" && !(url.protocol === "http:" && (isLocalHost(url.hostname) || approvedPrivateOrigin)))) throw new Error("API requires HTTPS (HTTP is allowed only on localhost or private networks)");
  const options: RequestInit = { ...init, method: init.method ?? request?.method, headers: init.headers ?? request?.headers, signal: init.signal ?? request?.signal };
  if (request && init.body === undefined && !["GET", "HEAD"].includes(options.method ?? "GET")) options.body = await request.text();
  const headers = new Headers(options.headers);
  headers.delete("origin"); headers.delete("referer"); headers.delete("cookie");
  if (!headers.has("user-agent")) headers.set("User-Agent", "QiaomuAgent/1.0");
  options.headers = headers;
  const net = nativeNet();
  const response = await (net ? nativeApiFetch(net, url.href, options) : bufferedApiFetch(url.href, options));
  if (response.headers.get("cf-mitigated") === "challenge" || response.headers.get("content-type")?.includes("text/html")) {
    await response.body?.cancel();
    throw new Error(t(response.headers.get("cf-mitigated") === "challenge" || response.headers.get("server")?.toLowerCase().includes("cloudflare") ? "challenge" : "invalidResponse"));
  }
  return response;
}

export function apiStatusError(status: number): Error {
  const key = status === 401 ? "unauthorized" : status === 403 ? "forbidden" : status === 404 ? "notFound" : status === 429 ? "rateLimit" : status >= 500 ? "server" : status >= 300 && status < 400 ? "redirect" : "http";
  return new Error(`${t(key)} (HTTP ${status})`);
}
export function connectionError(error: unknown): string {
  if (error instanceof SyntaxError) return t("invalidResponse");
  if (error instanceof Error && error.name === "TimeoutError") return t("timeout");
  if (error instanceof Error && error.name === "AbortError") return t("cancelled");
  const message = error instanceof Error ? error.message : String(error);
  return /failed to fetch|networkerror|load failed/i.test(message) ? t("network") : message.replace(/\b(?:sk-|Bearer\s+)[^\s"',;]+/gi, "[redacted]");
}
