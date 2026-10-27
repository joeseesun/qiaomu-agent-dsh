import { hasPrivateHttpConsent } from "./network-hosts";
import { apiFetch } from "./api-transport";
import { permitsEmptyKey, validateApiUrl } from "./api-providers";
import { accountText as t } from "../i18n/accounts";
import { getRuntimeRequire } from "./runtime-require";
import { accountObject } from "./account-json";

export const MAGPIE_BASE = "http://127.0.0.1:3425/v1";
/** Only public gateway settings; never read or modify Magpie's account/key files. */
export async function magpieAddress(): Promise<string> {
  const require = getRuntimeRequire();
  if (!require) return MAGPIE_BASE;
  try {
    const fs = require("node:fs/promises") as typeof import("node:fs/promises");
    const os = require("node:os") as typeof import("node:os");
    const path = require("node:path") as typeof import("node:path");
    const runtime = require("node:process") as typeof import("node:process");
    const root = runtime.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
    const config = accountObject(JSON.parse(await fs.readFile(path.join(root, "magpie", "settings.json"), "utf8")) as unknown);
    if (typeof config.port === "number" && Number.isInteger(config.port) && config.port > 0 && config.port < 65536) return `http://127.0.0.1:${config.port}/v1`;
  } catch { /* default address remains editable */ }
  return MAGPIE_BASE;
}

export async function detectMagpie(base: string, key: string, signal: AbortSignal, privateHttpApprovedUrl?: string): Promise<string> {
  const url = new URL(validateApiUrl(base, hasPrivateHttpConsent({ baseUrl: base, privateHttpApprovedUrl })));
  const local = permitsEmptyKey({ provider: "magpie", baseUrl: base, model: "", secretId: "" });
  if (!key && !local) throw new Error(t("gatewayKeyRequired"));
  // Preserve a reverse proxy prefix: /magpie/v1 -> /magpie/api/hello.
  url.pathname = `${url.pathname.replace(/\/+$/, "").replace(/\/v1$/, "")}/api/hello`;
  try {
    const response = await apiFetch(url.href, { headers: { Authorization: `Bearer ${key || "magpie-qiaomu-agent"}` }, redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) }, privateHttpApprovedUrl);
    if (!response.ok) throw new Error();
    const data = accountObject(await response.json() as unknown);
    if (data.name !== "magpie") throw new Error();
    return typeof data.version === "string" ? data.version : "";
  } catch { signal.throwIfAborted(); throw new Error(t("notMagpie")); }
}
