import { connectionText as ct } from "../i18n/connection";
import type { ApiConnection } from "../types";
import { hasPrivateHttpConsent, isLocalHost, isPrivateNetworkHost } from "./network-hosts";
export { isLocalHost, isPrivateNetworkHost, isPrivateHttpUrl } from "./network-hosts";

export type ProviderGroup = "cn" | "global" | "relay" | "local" | "custom" | "account" | "plan";

export interface ApiPreset {
  label: string;
  baseUrl: string;
  website: string;
  protocol?: ApiConnection["protocol"];
  local?: boolean;
  /** Key into BRAND_ICONS; missing means a generic mark. */
  icon?: string;
  group: ProviderGroup;
}

// Official endpoint references and verification limits: docs/research/provider-coverage.md.
export const API_PROVIDERS: Record<string, ApiPreset> = {
  chatgpt: { label: "ChatGPT", baseUrl: "https://api.openai.com/v1", website: "https://chatgpt.com/settings/usage", protocol: "openai-responses", icon: "openai", group: "account" },
  tokendance: { label: "词元跳动 · TokenDance", baseUrl: "https://tokendance.space/gateway/v1", website: "https://tokendance.space/keys", group: "relay" },
  magpie: { label: "Magpie · 订阅与模型网关", baseUrl: "http://127.0.0.1:3425/v1", website: "https://usemagpie.ai", local: true, group: "local" },
  "glm-coding": { label: "智谱 GLM · Coding Plan", baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4", website: "https://open.bigmodel.cn/usercenter/proj-mgmt/apikeys", icon: "zhipu", group: "plan" },
  "zai-coding": { label: "Z.ai · Coding Plan", baseUrl: "https://api.z.ai/api/coding/paas/v4", website: "https://z.ai/manage-apikey/apikey-list", icon: "zai", group: "plan" },
  "kimi-code": { label: "Kimi Code · 国内套餐", baseUrl: "https://api.kimi.com/coding/v1", website: "https://www.kimi.com/code/console", icon: "moonshot", group: "plan" },
  "minimax-plan": { label: "MiniMax · Token Plan", baseUrl: "https://api.minimaxi.com/v1", website: "https://platform.minimaxi.com/subscribe/coding-plan", icon: "minimax", group: "plan" },
  "bailian-plan": { label: "百炼 · Token Plan", baseUrl: "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1", website: "https://bailian.console.aliyun.com/cn-beijing/subscription/token-plan/personal", icon: "qwen", group: "plan" },
  "mimo-plan": { label: "小米 MiMo · Token Plan", baseUrl: "https://token-plan-cn.xiaomimimo.com/v1", website: "https://platform.xiaomimimo.com/token-plan", icon: "mimo", group: "plan" },
  "doubao-coding": { label: "火山方舟 · Coding Plan", baseUrl: "https://ark.cn-beijing.volces.com/api/coding/v3", website: "https://console.volcengine.com/ark", icon: "doubao", group: "plan" },
  openai: { label: "OpenAI", baseUrl: "https://api.openai.com/v1", website: "https://platform.openai.com/api-keys", icon: "openai", group: "global" },
  anthropic: { label: "Anthropic", baseUrl: "https://api.anthropic.com/v1", website: "https://console.anthropic.com", protocol: "anthropic", icon: "anthropic", group: "global" },
  google: { label: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta", website: "https://aistudio.google.com/apikey", protocol: "google", icon: "google", group: "global" },
  openrouter: { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", website: "https://openrouter.ai/settings/keys", icon: "openrouter", group: "relay" },
  siliconflow: { label: "硅基流动", baseUrl: "https://api.siliconflow.cn/v1", website: "https://cloud.siliconflow.cn", icon: "siliconflow", group: "relay" },
  deepseek: { label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", website: "https://platform.deepseek.com/api_keys", icon: "deepseek", group: "cn" },
  moonshot: { label: "Kimi · Moonshot", baseUrl: "https://api.moonshot.cn/v1", website: "https://platform.kimi.com", icon: "moonshot", group: "cn" },
  stepfun: { label: "阶跃星辰", baseUrl: "https://api.stepfun.com/v1", website: "https://platform.stepfun.com", icon: "stepfun", group: "cn" },
  mimo: { label: "小米 MiMo", baseUrl: "https://api.xiaomimimo.com/v1", website: "https://platform.xiaomimimo.com", icon: "mimo", group: "cn" },
  minimax: { label: "MiniMax", baseUrl: "https://api.minimaxi.com/v1", website: "https://platform.minimax.cn", icon: "minimax", group: "cn" },
  qwen: { label: "通义千问 · 北京", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", website: "https://bailian.console.aliyun.com", icon: "qwen", group: "cn" },
  "qwen-intl": { label: "通义千问 · 新加坡", baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", website: "https://modelstudio.console.alibabacloud.com", icon: "qwen", group: "cn" },
  glm: { label: "智谱 GLM", baseUrl: "https://open.bigmodel.cn/api/paas/v4", website: "https://bigmodel.cn/usercenter/proj-mgmt/apikeys", icon: "zhipu", group: "cn" },
  zai: { label: "Z.ai", baseUrl: "https://api.z.ai/api/paas/v4", website: "https://z.ai/manage-apikey/apikey-list", icon: "zai", group: "global" },
  doubao: { label: "豆包 · 火山方舟", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", website: "https://console.volcengine.com/ark", icon: "doubao", group: "cn" },
  baidu: { label: "百度千帆", baseUrl: "https://qianfan.baidubce.com/v2", website: "https://console.bce.baidu.com/qianfan", icon: "wenxin", group: "cn" },
  hunyuan: { label: "腾讯混元", baseUrl: "https://api.hunyuan.cloud.tencent.com/v1", website: "https://console.cloud.tencent.com/hunyuan", icon: "hunyuan", group: "cn" },
  xai: { label: "xAI · Grok", baseUrl: "https://api.x.ai/v1", website: "https://console.x.ai", icon: "xai", group: "global" },
  mistral: { label: "Mistral", baseUrl: "https://api.mistral.ai/v1", website: "https://console.mistral.ai", icon: "mistral", group: "global" },
  groq: { label: "Groq", baseUrl: "https://api.groq.com/openai/v1", website: "https://console.groq.com/keys", icon: "groq", group: "relay" },
  together: { label: "Together AI", baseUrl: "https://api.together.ai/v1", website: "https://api.together.ai", icon: "together", group: "relay" },
  fireworks: { label: "Fireworks AI", baseUrl: "https://api.fireworks.ai/inference/v1", website: "https://app.fireworks.ai", icon: "fireworks", group: "relay" },
  cerebras: { label: "Cerebras", baseUrl: "https://api.cerebras.ai/v1", website: "https://cloud.cerebras.ai", icon: "cerebras", group: "relay" },
  perplexity: { label: "Perplexity", baseUrl: "https://api.perplexity.ai", website: "https://www.perplexity.ai/settings/api", icon: "perplexity", group: "global" },
  ollama: { label: "Ollama · 本地", baseUrl: "http://localhost:11434/v1", website: "https://docs.ollama.com/api/openai-compatibility", local: true, icon: "ollama", group: "local" },
  lmstudio: { label: "LM Studio · 本地", baseUrl: "http://localhost:1234/v1", website: "https://lmstudio.ai/docs/developer/openai-compat", local: true, icon: "lmstudio", group: "local" },
  custom: { label: "自定义接口", baseUrl: "", website: "", group: "custom" },
};

export function apiProtocol(connection: ApiConnection): NonNullable<ApiConnection["protocol"]> {
  return connection.protocol ?? API_PROVIDERS[connection.provider]?.protocol ?? "openai-chat";
}

export function permitsEmptyKey(connection: ApiConnection): boolean {
  if (!API_PROVIDERS[connection.provider]?.local) return false;
  try { return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection.baseUrl).hostname); }
  catch { return false; }
}

/**
 * The URL the SDK appends endpoint paths to. Anthropic-compatible services are often entered without
 * their version segment (the Claude Code convention), which would send requests to `/messages`.
 */
export function apiBaseUrl(connection: ApiConnection): string {
  const base = validateApiUrl(connection.baseUrl, hasPrivateHttpConsent(connection)).replace(/\/(?:chat\/completions|responses|messages|models)$/, "").replace(/(\/v1)+$/, "/v1");
  const path = new URL(base).pathname.replace(/\/$/, "");
  const versioned = /\/v\d+[a-z0-9]*$/i.test(path);
  // Anthropic-compatible paths never carry the version (…/api/anthropic); OpenAI-compatible ones do
  // unless a relay mounts its own prefix, so only a bare origin gets /v1 there (as CC Switch does).
  if (apiProtocol(connection) === "anthropic") return versioned ? base : `${base}/v1`;
  if (apiProtocol(connection) === "google") return base;
  return !versioned && path === "" ? `${base}/v1` : base;
}

export function validateApiUrl(value: string, options?: { allowPrivateHttp?: boolean } | boolean): string {
  const allowPrivate = typeof options === "boolean" ? options : Boolean(options?.allowPrivateHttp);
  const url = new URL(value.trim());
  if (url.username || url.password || url.search || url.hash) throw new Error("API 地址不能包含账号、密钥或查询参数");
  if (url.protocol !== "https:") {
    if (url.protocol !== "http:") throw new Error("API 地址协议必须是 HTTP 或 HTTPS");
    if (!isLocalHost(url.hostname)) {
      if (isPrivateNetworkHost(url.hostname)) {
        if (!allowPrivate) throw new Error(ct("privateHttpRequired"));
      } else {
        throw new Error("远程 API 请使用 HTTPS；HTTP 仅用于本机服务");
      }
    }
  }
  return url.toString().replace(/\/+$/, "");
}

