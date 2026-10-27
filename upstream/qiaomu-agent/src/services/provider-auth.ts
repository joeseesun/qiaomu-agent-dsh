import type { ApiConnection } from "../types";
import { apiFetch } from "./api-transport";
import { accountText as t } from "../i18n/accounts";
import { listenOAuth } from "./oauth-loopback";
import { permitsEmptyKey } from "./api-providers";
import { accountObject as object, accountString as requiredString, accountExpiry } from "./account-json";

export type LoginKind = "chatgpt" | "openrouter" | "tokendance";
export interface SecretStore { getSecret(id: string): string | null; setSecret(id: string, value: string): void }
export interface AccountCredentials {
  version: 1; clientId: string; subject: string; email: string; hostId: string;
  access: string; refresh: string; idToken: string; expires: number; scopes: string[];
}
const issuer = "https://auth.openai.com";
const tokenUrl = `${issuer}/api/accounts/oauth/token`;
const resource = "https://api.openai.com/v1";
const scope = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
const sessions = new Set<AbortController>();
export function cancelAccountLogins(): void { for (const c of sessions) c.abort(); sessions.clear(); }
export function loginKind(provider: string): LoginKind | undefined { return ["chatgpt", "openrouter", "tokendance"].includes(provider) ? provider as LoginKind : undefined; }
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const bytes = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")), c => c.charCodeAt(0));
export const randomOAuth = () => b64(crypto.getRandomValues(new Uint8Array(48)));
export async function pkceChallenge(verifier: string): Promise<string> { return b64(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)))); }

async function json(url: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const response = await apiFetch(url, { ...init, redirect: "error", signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000) });
  if (!response.ok) { await response.body?.cancel(); throw new Error(response.status === 400 || response.status === 401 ? t("expired") : t("failed")); }
  return object(await response.json() as unknown);
}
async function token(body: Record<string, string>, signal?: AbortSignal) {
  return json(tokenUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body).toString(), signal });
}

export function readAccount(raw: string): AccountCredentials | null {
  try {
    const c = object(JSON.parse(raw) as unknown);
    if (c.version !== 1 || typeof c.access !== "string" || typeof c.refresh !== "string" || typeof c.expires !== "number" || !Number.isFinite(c.expires) || !Array.isArray(c.scopes) || !c.scopes.every((s: unknown) => typeof s === "string")) return null;
    return { version: 1, clientId: requiredString(c.clientId), subject: requiredString(c.subject), access: c.access, refresh: c.refresh, expires: c.expires,
      scopes: c.scopes.filter((s: unknown): s is string => typeof s === "string"), email: typeof c.email === "string" ? c.email : "", hostId: typeof c.hostId === "string" ? c.hostId : "", idToken: typeof c.idToken === "string" ? c.idToken : "" };
  } catch { return null; }
}

/** Verify, never merely decode, the identity supplied by the issuer. */
export async function validateIdentity(jwt: string, clientId: string, nonce: string, signal: AbortSignal): Promise<{ sub: string; email: string }> {
  try {
    const parts = jwt.split(".");
    if (parts.length !== 3) throw new Error();
    const header = object(JSON.parse(new TextDecoder().decode(bytes(parts[0]!))) as unknown);
    const claims = object(JSON.parse(new TextDecoder().decode(bytes(parts[1]!))) as unknown);
    if (header.alg !== "RS256" || typeof header.kid !== "string") throw new Error();
    const discovery = await json(`${issuer}/.well-known/openid-configuration`, { signal });
    const jwksUrl = new URL(requiredString(discovery.jwks_uri));
    if (jwksUrl.origin !== issuer || discovery.issuer !== issuer) throw new Error();
    const jwks = await json(jwksUrl.href, { signal });
    if (!Array.isArray(jwks.keys)) throw new Error();
    const jwk = jwks.keys.map((key: unknown) => object(key)).find(key => key.kid === header.kid && key.kty === "RSA" && (!key.use || key.use === "sig") && (!key.alg || key.alg === "RS256"));
    if (!jwk) throw new Error();
    const key = await crypto.subtle.importKey("jwk", { kty: "RSA", n: requiredString(jwk.n), e: requiredString(jwk.e), alg: "RS256", use: "sig" }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    if (!await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, bytes(parts[2]!), new TextEncoder().encode(`${parts[0]}.${parts[1]}`))) throw new Error();
    const audience: unknown[] = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (claims.iss !== issuer || !audience.includes(clientId) || (audience.length > 1 && claims.azp !== clientId) || claims.nonce !== nonce || typeof claims.exp !== "number" || claims.exp <= Date.now() / 1000 || typeof claims.sub !== "string" || !claims.sub) throw new Error();
    if (claims.nbf !== undefined && (typeof claims.nbf !== "number" || claims.nbf > Date.now() / 1000 + 60)) throw new Error();
    return { sub: claims.sub, email: typeof claims.email === "string" ? claims.email : "" };
  } catch { signal.throwIfAborted(); throw new Error(t("invalid")); }
}

export function authorizationUrl(kind: LoginKind, redirect: string, state: string, challenge: string, nonce: string, hostId: string, existing?: AccountCredentials): string {
  if (kind === "chatgpt") return `${issuer}/api/accounts/authorize?${new URLSearchParams({
    client_id: existing?.clientId || "dynamic_agent_client", ...(existing ? {} : { agent_name_hint: "Qiaomu Agent" }), ext_agent_host_id: hostId,
    response_type: "code", redirect_uri: redirect, scope, resource, state, nonce, code_challenge: challenge, code_challenge_method: "S256",
  })}`;
  const query = new URLSearchParams({ callback_url: redirect, code_challenge: challenge, code_challenge_method: "S256" });
  if (kind === "openrouter") { query.set("state", state); query.set("key_label", "Qiaomu Agent"); }
  else { query.set("app_url", "https://github.com/joeseesun/Qiaomu-agent"); query.set("key_name", "Qiaomu Agent"); }
  return `${kind === "openrouter" ? "https://openrouter.ai" : "https://tokendance.space"}/auth?${query}`;
}

/** Caller owns persistence. Aborted or stale dialogs never commit credentials. */
export async function signInAccount(kind: LoginKind, store: SecretStore, openBrowser: (url: string) => void, signal: AbortSignal, existing?: AccountCredentials): Promise<{ secret: string; label?: string }> {
  const controller = new AbortController(); sessions.add(controller);
  const combined = AbortSignal.any([signal, controller.signal, AbortSignal.timeout(10 * 60_000)]);
  let listener: Awaited<ReturnType<typeof listenOAuth>> | undefined;
  try {
    const verifier = randomOAuth(), state = randomOAuth(), nonce = randomOAuth();
    let hostId = store.getSecret("qiaomu-agent-oauth-host");
    if (!hostId) { hostId = `urn:uuid:${crypto.randomUUID()}`; store.setSecret("qiaomu-agent-oauth-host", hostId); }
    listener = await listenOAuth(state, combined, kind === "tokendance");
    const challenge = await pkceChallenge(verifier);
    combined.throwIfAborted();
    openBrowser(authorizationUrl(kind, listener.redirect, state, challenge, nonce, hostId, existing));
    const back = await listener.result;
    combined.throwIfAborted();
    const code = back.searchParams.get("code");
    if (!code) throw new Error(t("failed"));
    if (kind !== "chatgpt") {
      const data = await json(kind === "openrouter" ? "https://openrouter.ai/api/v1/auth/keys" : "https://tokendance.space/portal/api/v1/auth/keys", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: "S256" }), signal: combined,
      });
      combined.throwIfAborted();
      if (typeof data.key !== "string" || !data.key) throw new Error(t("failed"));
      return { secret: data.key };
    }
    const clientId = back.searchParams.get("client_id") || existing?.clientId;
    if (!clientId || clientId === "dynamic_agent_client" || (existing && clientId !== existing.clientId)) throw new Error(t("invalid"));
    const data = await token({ grant_type: "authorization_code", client_id: clientId, code, code_verifier: verifier, redirect_uri: listener.redirect, resource }, combined);
    const identity = await validateIdentity(requiredString(data.id_token), clientId, nonce, combined);
    if (existing && identity.sub !== existing.subject) throw new Error(t("invalid"));
    const scopes = typeof data.scope === "string" ? data.scope.split(/\s+/) : [];
    if (!scopes.includes("chatgpt.tokens.use.direct")) throw new Error(t("unsupported"));
    combined.throwIfAborted();
    const creds: AccountCredentials = { version: 1, clientId, subject: identity.sub, email: identity.email, hostId, access: requiredString(data.access_token), refresh: requiredString(data.refresh_token), idToken: requiredString(data.id_token), expires: accountExpiry(data.expires_in), scopes };
    return { secret: JSON.stringify(creds), label: identity.email || "ChatGPT" };
  } finally { listener?.close(); sessions.delete(controller); }
}

const refreshing = new Map<string, Promise<string>>();
const pending = new Map<string, { before: string; after: string }>();
export async function accessToken(connection: ApiConnection, raw: string, store?: SecretStore): Promise<string> {
  if (connection.provider !== "chatgpt") return raw || (connection.provider === "magpie" && permitsEmptyKey(connection) ? "magpie-qiaomu-agent" : "");
  if (connection.baseUrl !== resource) throw new Error(t("invalid"));
  if (!store) throw new Error(t("expired"));
  const key = connection.secretId;
  const run = async () => {
    let saved = store.getSecret(key) ?? "";
    const unsaved = pending.get(key);
    if (unsaved) {
      if (saved === unsaved.before) { store.setSecret(key, unsaved.after); saved = unsaved.after; }
      pending.delete(key);
    }
    const creds = readAccount(saved);
    if (!creds?.access || !creds.refresh) throw new Error(t("expired"));
    if (creds.expires > Date.now() + 180_000) return creds.access;
    const data = await token({ grant_type: "refresh_token", client_id: creds.clientId, refresh_token: creds.refresh, resource });
    if (typeof data.access_token !== "string" || !data.access_token) throw new Error(t("expired"));
    if (store.getSecret(key) !== saved) throw new Error(t("expired"));
    const scopes = typeof data.scope === "string" ? data.scope.split(/\s+/) : creds.scopes;
    if (!scopes.includes("chatgpt.tokens.use.direct")) throw new Error(t("unsupported"));
    const next = JSON.stringify({ ...creds, access: data.access_token, refresh: data.refresh_token === undefined ? creds.refresh : requiredString(data.refresh_token), scopes, expires: accountExpiry(data.expires_in) });
    pending.set(key, { before: saved, after: next });
    store.setSecret(key, next); pending.delete(key);
    return data.access_token;
  };
  let promise = refreshing.get(key);
  if (!promise) {
    promise = (async () => typeof navigator !== "undefined" && navigator.locks ? await navigator.locks.request(`qa-oauth-${key}`, run) : await run())().finally(() => refreshing.delete(key));
    refreshing.set(key, promise);
  }
  return promise;
}

export async function signOutAccount(id: string, store: SecretStore): Promise<boolean> {
  const saved = store.getSecret(id) ?? "", creds = readAccount(saved);
  // Clear locally before awaiting the network, so an in-flight refresh cannot restore this session.
  store.setSecret(id, creds ? JSON.stringify({ ...creds, access: "", refresh: "", idToken: "", expires: 0 }) : "");
  pending.delete(id);
  let revoked = false;
  try {
    if (creds?.refresh) {
      const discovery = await json(`${issuer}/.well-known/openid-configuration`);
      const url = new URL(requiredString(discovery.revocation_endpoint));
      if (url.origin !== issuer) throw new Error();
      const response = await apiFetch(url.href, { method: "POST", redirect: "error", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: creds.refresh, token_type_hint: "refresh_token", client_id: creds.clientId }).toString(), signal: AbortSignal.timeout(15_000) });
      revoked = response.ok; await response.body?.cancel();
    } else revoked = true;
  } catch { /* report unconfirmed remote revocation to the user */ }
  return revoked;
}
