import type { ContextUsage } from "../types";

const MAX_TOKENS = 100_000_000;

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_TOKENS ? Math.round(value) : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Only real, reported numbers: a window of zero or an unknown size means nothing to show. */
export function contextUsage(used: unknown, size: unknown): ContextUsage | null {
  const u = count(used);
  const s = count(size);
  return u === null || !s ? null : { used: u, size: s };
}

/** Codex App Server `thread/tokenUsage/updated`: the last request's tokens are what sits in the window now. */
export function codexContextUsage(params: unknown): ContextUsage | null {
  const usage = record(record(params)?.tokenUsage);
  return contextUsage(record(usage?.last)?.totalTokens, usage?.modelContextWindow);
}

/** ACP `usage_update` session update. */
export function acpContextUsage(update: Record<string, unknown>): ContextUsage | null {
  return contextUsage(update.used, update.size);
}

/** Model API: the final step's prompt plus its answer is what the next turn starts from. */
export function apiContextUsage(usage: { inputTokens?: number; outputTokens?: number } | undefined, size: number | undefined): ContextUsage | null {
  if (usage?.inputTokens === undefined) return null;
  return contextUsage(usage.inputTokens + (usage.outputTokens ?? 0), size);
}
