import type { Server, IncomingMessage, ServerResponse } from "node:http";
import { getRuntimeRequire } from "./runtime-require";
import { accountText as t } from "../i18n/accounts";

export interface OAuthCallback { redirect: string; result: Promise<URL>; close(): void }
/** Only the exact attempt's loopback URL can finish it; unrelated requests do not consume it. */
export async function listenOAuth(state: string, signal: AbortSignal, tokenDance = false): Promise<OAuthCallback> {
  const require = getRuntimeRequire();
  if (!require) throw new Error(t("desktop"));
  const http = require("node:http") as typeof import("node:http");
  signal.throwIfAborted();
  let resolve!: (url: URL) => void, reject!: (error: unknown) => void;
  const result = new Promise<URL>((res, rej) => { resolve = res; reject = rej; });
  void result.catch(() => {});
  let redirect = "", settled = false;
  let server: Server;
  const close = () => { server?.close(); server?.closeAllConnections(); signal.removeEventListener("abort", abort); };
  const fail = (error: unknown) => { if (!settled) { settled = true; reject(error); } close(); };
  const abort = () => fail(signal.reason);
  server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
    const invalid = () => { res.writeHead(400, { "Content-Type": "text/plain", "Cache-Control": "no-store" }); res.end("Invalid callback"); };
    if (!redirect) { invalid(); return; }
    const expected = new URL(redirect);
    let url: URL;
    try { url = new URL(req.url ?? "/", expected.origin); } catch { invalid(); return; }
    if (req.method !== "GET" || req.headers.host !== expected.host || url.origin !== expected.origin || url.pathname !== expected.pathname || url.searchParams.getAll("state").length !== 1 || url.searchParams.get("state") !== state || settled) {
      invalid(); return;
    }
    settled = true;
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "Content-Security-Policy": "default-src 'none'" });
    res.end(t("complete"));
    // Let the small success response flush before closing the listener.
    res.once("finish", close);
    if (url.searchParams.has("error") || url.searchParams.getAll("code").length !== 1) reject(new Error(t("failed")));
    else resolve(url);
  });
  await new Promise<void>((res, rej) => {
    server.once("error", rej);
    server.listen(0, "127.0.0.1", () => { server.removeListener("error", rej); res(); });
  }).catch(error => { fail(error); throw error; });
  const port = (server.address() as import("node:net").AddressInfo).port;
  redirect = `http://127.0.0.1:${port}/auth/callback${tokenDance ? `?state=${encodeURIComponent(state)}` : ""}`;
  server.on("error", fail);
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  return { redirect, result, close };
}
