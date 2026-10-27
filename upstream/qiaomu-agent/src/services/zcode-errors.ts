export function zcodeError(stderr: string, fallback: string): string {
  if (stderr.includes("1309") || stderr.includes("套餐已到期")) return "ZCode 当前模型的 GLM Coding Plan 套餐已到期，请在 ZCode 中切换可用模型或续订后重试";
  // Never render provider stacks, headers or cookies in chat.
  const line = stderr.split(/\r?\n/).find((entry) => /^(Error:|ProviderBusinessError:)/.test(entry));
  return (line || fallback).slice(0, 600);
}
