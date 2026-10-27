import type { ApiConnection } from "../types";

/**
 * How one reasoning level reaches each kind of API. Vendors disagree on the switch; the rules follow
 * ZCode's built-in provider data (Apache-2.0) and CC Switch's Claude handling (MIT), re-expressed here.
 */
export interface ThinkingRequest {
  /** The AI SDK's provider-neutral setting, mapped by the SDK itself. */
  reasoning?: "low" | "medium" | "high";
  providerOptions?: Record<string, Record<string, unknown>>;
  /** Fields merged into the JSON request body for switches the SDK does not know. */
  body?: Record<string, unknown>;
}

type Effort = NonNullable<ThinkingRequest["reasoning"]>;

/** Relays rename models (`anthropic/claude-sonnet-4.6`), so compare with `.` and `_` as `-`. */
export function normalizeModelId(model: string): string {
  return model.trim().toLowerCase().replace(/[._]/g, "-");
}

/** Claude models that take adaptive thinking with an effort level instead of a token budget. */
export function usesAdaptiveThinking(model: string): boolean {
  const id = normalizeModelId(model);
  return ["fable-5", "mythos-5", "mythos-preview", "sonnet-5", "opus-5", "opus-4-8", "opus-4-7", "opus-4-6", "sonnet-4-6"].some((family) => id.includes(family));
}

export function thinkingRequest(connection: Pick<ApiConnection, "provider" | "protocol">, protocol: string, model: string, effort: string | undefined): ThinkingRequest {
  if (connection.provider === "deepseek" && protocol === "openai-chat" && effort === "none") {
    return { body: { thinking: { type: "disabled" } } };
  }
  if (connection.provider === "deepseek" && protocol === "openai-chat" && (effort === "low" || effort === "high" || effort === "max")) {
    return { body: { thinking: { type: "enabled" }, reasoning_effort: effort } };
  }
  if ((connection.provider === "magpie" || connection.provider === "chatgpt") && effort && /^[a-z0-9_-]{1,24}$/.test(effort)) {
    return { body: protocol === "openai-responses" ? { reasoning: { effort } } : { reasoning_effort: effort } };
  }
  if (effort !== "low" && effort !== "medium" && effort !== "high") return {};
  const level: Effort = effort;
  if (protocol === "anthropic") {
    // The SDK recognises adaptive Claude models only by their canonical ids; relays often rename them.
    return usesAdaptiveThinking(model) ? { providerOptions: { anthropic: { thinking: { type: "adaptive" }, effort: level } } } : { reasoning: level };
  }
  if (protocol !== "openai-chat" || connection.provider === "openai") return { reasoning: level };
  if (connection.provider === "openrouter") return { body: { reasoning: { effort: level } } };
  // OpenAI-compatible services each read a different field and ignore the others.
  return { body: { thinking: { type: "enabled" }, enable_thinking: true, reasoning_effort: level, reasoning: { effort: level } } };
}

/** Model families known to think, so "自动" can say 支持 without a vendor capability list. */
const THINKING_FAMILIES = [
  /claude-(?:sonnet|opus|haiku)-4-[5-9]/, /claude-(?:opus|sonnet)-4(?:-\d{8})?$/, /claude-(?:opus|sonnet|fable|mythos)-5/,
  /(?:^|\/)gpt-5/, /(?:^|\/)o[134](?:-|$)/, /gemini-(?:2-5|3)/,
  /deepseek-(?:v4|flash|reasoner|r1)/, /kimi-k2-[5-9]|kimi-k3|(?:^|\/)k3(?:-|$)/, /glm-(?:4-[5-9]|5)/,
  /qwen3|qwen-(?:plus|flash|max)|qwq/, /mimo-v2/, /minimax-m[23]/, /grok-(?:3-mini|4)/,
];

export function knownToThink(model: string): boolean {
  const id = normalizeModelId(model);
  return THINKING_FAMILIES.some((pattern) => pattern.test(id));
}

/**
 * Confirmed text-only models (after CC Switch's registry). Exact tails only: a new `-vl` or `v`
 * variant stays unknown, and unknown models are never blocked.
 */
const TEXT_ONLY = new Set([
  "deepseek-chat", "deepseek-reasoner", "glm-5-1", "glm-5-2", "glm-5-3", "kat-coder", "kat-coder-pro", "minimax-m2-7",
  "mimo-v2-5-pro", "qwen3-coder-480b", "qwen3-coder-plus", "qwen3-coder-flash", "qwen3-coder-next", "step-3-5-flash",
]);

export function knownTextOnly(model: string): boolean {
  return TEXT_ONLY.has(normalizeModelId(model).split("/").at(-1) ?? "");
}
