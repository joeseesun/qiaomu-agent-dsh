import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import { accessToken, authorizationUrl, pkceChallenge, readAccount, signInAccount, signOutAccount, validateIdentity, type AccountCredentials } from "../src/services/provider-auth";
import { listenOAuth } from "../src/services/oauth-loopback";
import { apiFetch } from "../src/services/api-transport";
import { DEFAULT_SETTINGS } from "../src/defaults";
vi.mock("../src/services/runtime-require", () => ({ getRuntimeRequire: () => createRequire(import.meta.url) }));
vi.mock("../src/services/api-transport", () => ({ apiFetch: vi.fn() }));
const http = vi.mocked(apiFetch);
const conn = { ...DEFAULT_SETTINGS.api, provider: "chatgpt", baseUrl: "https://api.openai.com/v1", secretId: "a" };
function store(initial: Record<string, string> = {}) { const m = new Map(Object.entries(initial)); return { getSecret: (id: string) => m.get(id) ?? null, setSecret: (id: string, value: string) => { m.set(id, value); } }; }
const account = (over: Partial<AccountCredentials> = {}): AccountCredentials => ({ version: 1, clientId: "client-a", subject: "sub-a", email: "a@example.com", hostId: "urn:uuid:a", access: "old-a", refresh: "refresh-a", idToken: "", expires: 0, scopes: ["chatgpt.tokens.use.direct"], ...over });
afterEach(() => vi.resetAllMocks());

describe("desktop OAuth", () => {
  it("uses S256 and preserves TokenDance state inside its callback", async () => {
    const challenge = await pkceChallenge("x".repeat(64));
    expect(challenge).toHaveLength(43);
    const url = new URL(authorizationUrl("tokendance", "http://127.0.0.1:1234/auth/callback?state=abc", "abc", challenge, "nonce", "host"));
    expect(url.searchParams.get("callback_url")).toContain("state=abc");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });
  it("ignores invalid state and wrong paths, accepts the exact callback once, then closes", async () => {
    const c = new AbortController(); const listener = await listenOAuth("valid", c.signal);
    try {
      expect((await fetch(`${listener.redirect}?state=invalid&code=x`)).status).toBe(400);
      expect((await fetch(`${listener.redirect}-wrong?state=valid&code=x`)).status).toBe(400);
      expect((await fetch(`${listener.redirect}?state=valid&code=ok`)).status).toBe(200);
      expect((await listener.result).searchParams.get("code")).toBe("ok");
    } finally { listener.close(); }
  });
  it("aborts and removes a pending listener", async () => {
    const c = new AbortController(); const listener = await listenOAuth("valid", c.signal);
    c.abort(); await expect(listener.result).rejects.toThrow();
    await expect(fetch(listener.redirect)).rejects.toThrow();
  });
  it.each(["openrouter", "tokendance"] as const)("completes %s browser callback and exchanges only once", async kind => {
    http.mockResolvedValue(new Response(JSON.stringify({ key: "test-key" })));
    let browserUrl!: URL;
    const result = await signInAccount(kind, store(), raw => {
      browserUrl = new URL(raw);
      const callback = new URL(browserUrl.searchParams.get("callback_url")!);
      if (kind === "openrouter") callback.searchParams.set("state", browserUrl.searchParams.get("state")!);
      callback.searchParams.set("code", "single-use-code");
      void fetch(callback).catch(() => {});
    }, new AbortController().signal);
    expect(result.secret).toBe("test-key"); expect(http).toHaveBeenCalledOnce();
    const body = JSON.parse(http.mock.calls[0]![1]!.body as string);
    expect(await pkceChallenge(body.code_verifier)).toBe(browserUrl.searchParams.get("code_challenge"));
  });
  it("does not return credentials from a cancelled code exchange", async () => {
    const c = new AbortController();
    http.mockImplementation(async () => { c.abort(); return new Response(JSON.stringify({ key: "must-not-save" })); });
    await expect(signInAccount("tokendance", store(), raw => {
      const callback = new URL(new URL(raw).searchParams.get("callback_url")!); callback.searchParams.set("code", "x"); void fetch(callback).catch(() => {});
    }, c.signal)).rejects.toThrow();
  });
});

describe("isolated rotating credentials", () => {
  it("merges same-account refreshes but never mixes separate accounts", async () => {
    const s = store({ a: JSON.stringify(account()), b: JSON.stringify(account({ clientId: "client-b", refresh: "refresh-b", subject: "sub-b" })) });
    http.mockImplementation(async (_url, init) => {
      const client = new URLSearchParams(init!.body as string).get("client_id");
      return new Response(JSON.stringify({ access_token: `token-${client}`, refresh_token: `rotated-${client}`, expires_in: 3600 }));
    });
    expect(await Promise.all([accessToken(conn, "", s), accessToken(conn, "", s), accessToken({ ...conn, secretId: "b" }, "", s)])).toEqual(["token-client-a", "token-client-a", "token-client-b"]);
    expect(http).toHaveBeenCalledTimes(2); expect(readAccount(s.getSecret("a")!)?.refresh).toBe("rotated-client-a");
  });
  it("retries saving a rotated credential without spending the old refresh token twice", async () => {
    const s = store({ a: JSON.stringify(account()) }); const real = s.setSecret; let fail = true;
    s.setSecret = (id, value) => { if (fail) { fail = false; throw new Error("disk"); } real(id, value); };
    http.mockResolvedValue(new Response(JSON.stringify({ access_token: "new", refresh_token: "new-refresh", expires_in: 3600 })));
    await expect(accessToken(conn, "", s)).rejects.toThrow("disk");
    expect(await accessToken(conn, "", s)).toBe("new"); expect(http).toHaveBeenCalledOnce();
  });
  it("never resurrects credentials cleared during a refresh", async () => {
    const s = store({ a: JSON.stringify(account()) });
    http.mockImplementation(async () => { s.setSecret("a", ""); return new Response(JSON.stringify({ access_token: "late" })); });
    await expect(accessToken(conn, "", s)).rejects.toThrow(); expect(s.getSecret("a")).toBe("");
  });
  it("refuses to send ChatGPT tokens to a changed endpoint", async () => {
    await expect(accessToken({ ...conn, baseUrl: "https://other.example/v1" }, "", store())).rejects.toThrow(); expect(http).not.toHaveBeenCalled();
  });
  it("clears tokens on failed revocation but keeps the account registration", async () => {
    const s = store({ a: JSON.stringify(account()) }); http.mockRejectedValue(new Error("offline"));
    expect(await signOutAccount("a", s)).toBe(false);
    expect(readAccount(s.getSecret("a")!)).toMatchObject({ clientId: "client-a", subject: "sub-a", access: "", refresh: "" });
  });
});

it("validates a signed ID token and rejects modified claims", async () => {
  const keys = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const jwk = { ...await crypto.subtle.exportKey("jwk", keys.publicKey), kid: "test" };
  const enc = (x: object) => Buffer.from(JSON.stringify(x)).toString("base64url");
  const payload = `${enc({ alg: "RS256", kid: "test" })}.${enc({ iss: "https://auth.openai.com", aud: "client", sub: "user", nonce: "nonce", exp: Date.now() / 1000 + 300 })}`;
  const signature = Buffer.from(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keys.privateKey, new TextEncoder().encode(payload))).toString("base64url");
  http.mockImplementation(async url => new Response(JSON.stringify(String(url).includes("openid-configuration") ? { issuer: "https://auth.openai.com", jwks_uri: "https://auth.openai.com/jwks" } : { keys: [jwk] })));
  expect(await validateIdentity(`${payload}.${signature}`, "client", "nonce", new AbortController().signal)).toMatchObject({ sub: "user" });
  await expect(validateIdentity(`${payload}.${signature}`, "client", "wrong-nonce", new AbortController().signal)).rejects.toThrow();
  await expect(validateIdentity(`${payload.slice(0, -2)}AA.${signature}`, "client", "nonce", new AbortController().signal)).rejects.toThrow();
});

it("clears the local session before remote revocation finishes", async () => {
  const s = store({ a: JSON.stringify(account({ expires: Date.now() + 3600000 })) });
  let release!: (response: Response) => void;
  http.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const leaving = signOutAccount("a", s);
  expect(readAccount(s.getSecret("a")!)?.access).toBe("");
  await expect(accessToken(conn, "old-a", s)).rejects.toThrow();
  release(new Response("{}"));
  expect(await leaving).toBe(false);
});

it("requires an actual key for remote Magpie and never fabricates its local app key", async () => {
  expect(await accessToken({ ...conn, provider: "magpie", baseUrl: "https://gateway.example/v1" }, "")).toBe("");
  expect(await accessToken({ ...conn, provider: "magpie", baseUrl: "http://127.0.0.1:3425/v1" }, "")).toBe("magpie-qiaomu-agent");
});

it("rejects malformed saved accounts and malformed rotated refresh tokens", async () => {
  expect(readAccount('{"version":1,"clientId":{},"subject":[]}')).toBeNull();
  expect(readAccount(JSON.stringify(account({ scopes: [42] as unknown as string[] })))).toBeNull();
  const s = store({ a: JSON.stringify(account()) });
  http.mockResolvedValue(new Response(JSON.stringify({ access_token: "new", refresh_token: { unsafe: true }, expires_in: 3600 })));
  await expect(accessToken(conn, "", s)).rejects.toThrow();
  expect(readAccount(s.getSecret("a")!)?.refresh).toBe("refresh-a");
});
