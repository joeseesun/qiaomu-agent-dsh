import type { ChatAttachment, ModelChoice, ModelOptions, ProviderConfig } from "../types";
import { knownTextOnly, knownToThink } from "./thinking";

/** Levels offered when a model thinks but its vendor has no narrower list of its own. */
export const DEFAULT_EFFORTS = ["low", "medium", "high"];

const MAX_WINDOW = 100_000_000;

function positive(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= MAX_WINDOW ? value : undefined;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/**
 * Capabilities a vendor's model list states, under the names vendors actually use
 * (OpenRouter, OpenAI-compatible relays, Anthropic, Gemini). Anything unstated stays unknown.
 */
export function reportedCapabilities(raw: Record<string, unknown>): Pick<ModelChoice, "contextWindow" | "vision" | "reasoning"> {
  let contextWindow: number | undefined;
  for (const key of ["context_length", "context_window", "max_context_length", "max_input_tokens", "inputTokenLimit"]) {
    contextWindow = positive(raw[key]);
    if (contextWindow) break;
  }
  const architecture = raw.architecture && typeof raw.architecture === "object" ? raw.architecture as Record<string, unknown> : {};
  const inputs = [...strings(architecture.input_modalities), ...strings(raw.input_modalities), ...strings(raw.modalities)];
  const parameters = strings(raw.supported_parameters);
  const effort = raw.effort && typeof raw.effort === "object" ? raw.effort as Record<string, unknown> : {};
  const result: Pick<ModelChoice, "contextWindow" | "vision" | "reasoning"> = {};
  if (contextWindow) result.contextWindow = contextWindow;
  if (inputs.length) result.vision = inputs.includes("image");
  if (parameters.length || typeof raw.thinking === "boolean" || typeof raw.reasoning === "boolean" || (raw.reasoning && typeof raw.reasoning === "object") || Array.isArray(effort.supported_levels)) {
    result.reasoning = parameters.includes("reasoning") || raw.thinking === true || raw.reasoning === true || Boolean(raw.reasoning && typeof raw.reasoning === "object") || strings(effort.supported_levels).length > 0;
  }
  return result;
}

/** Effort levels the vendor is known to accept for this model, before any user choice. */
export function builtinEfforts(provider: string, model: string): string[] {
  if (provider === "deepseek" && /^deepseek-(?:flash|v4-(?:flash(?:-vision-exp)?|pro))$/.test(model)) return ["none", "low", "high", "max"];
  if (provider === "openai" && /^(gpt-5|o[134])/.test(model)) return ["low", "medium", "high"];
  if (provider === "google" && /^gemini-3/.test(model)) return ["low", "high"];
  return [];
}

export interface ResolvedModel {
  contextWindow?: number;
  /** false only when known not to accept images; undefined means unknown, so images are sent. */
  vision?: boolean;
  /** Whether the model thinks; undefined means unknown. */
  thinking?: boolean;
  efforts: string[];
}

/** User settings win, then what the vendor reported, then built-in knowledge. */
export function resolveModel(provider: Pick<ProviderConfig, "provider" | "models" | "modelOptions">, id: string): ResolvedModel {
  const reported = provider.models?.find((model) => model.id === id);
  const options: ModelOptions = provider.modelOptions?.[id] ?? {};
  const builtin = builtinEfforts(provider.provider, id);
  const thinking = options.reasoning ?? (builtin.length ? true : reported?.reasoning ?? (knownToThink(id) || undefined));
  return {
    contextWindow: options.contextWindow ?? reported?.contextWindow,
    vision: options.vision ?? reported?.vision ?? (knownTextOnly(id) ? false : undefined),
    thinking,
    efforts: thinking ? reported?.efforts?.length ? (builtin.includes("none") ? ["none", ...reported.efforts.filter((level) => level !== "none")] : reported.efforts) : builtin.length ? builtin : DEFAULT_EFFORTS : [],
  };
}

/** Stops images before they reach a model known not to read them; unknown models are not blocked. */
export function checkImageInput(model: ResolvedModel, attachments: readonly ChatAttachment[]): void {
  if (model.vision === false && attachments.some((attachment) => attachment.mediaType.startsWith("image/"))) {
    throw new Error("这个模型不支持图片输入。请换一个支持图片的模型；如果它其实支持，可以在模型设置里把图片输入改为「支持」");
  }
}

/** 950 → "950", 128_000 → "128K", 1_048_576 → "1M". */
export function compactTokens(value: number): string {
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${Number((value / 1000).toFixed(value < 10_000 ? 1 : 0))}K`;
  return `${Number((value / 1_000_000).toFixed(1))}M`;
}
