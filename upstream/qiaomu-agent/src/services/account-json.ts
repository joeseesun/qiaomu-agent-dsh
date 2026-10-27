import { accountText as t } from "../i18n/accounts";

export function accountObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(t("invalid"));
  return value as Record<string, unknown>;
}
export function accountString(value: unknown): string {
  if (typeof value !== "string" || !value) throw new Error(t("invalid"));
  return value;
}
export function accountExpiry(value: unknown): number {
  if (value === undefined) return Date.now() + 3600_000;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new Error(t("invalid"));
  return Date.now() + value * 1000;
}
