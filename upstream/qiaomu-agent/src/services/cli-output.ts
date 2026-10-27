import { extractJsonEventText, stripAnsi } from "../utils";

export interface ParsedCliOutput {
  text: string;
  error: string | null;
  terminal: boolean;
}

function configurationError(text: string): string | null {
  const normalized = text.trim();
  if (/^LLM not set$/i.test(normalized)) return normalized;
  if (/not logged in.*(?:run|use) \/?login/i.test(normalized)) return normalized;
  if (/not signed in/i.test(normalized)) return normalized;
  if (/no API key found/i.test(normalized)) return normalized;
  if (/set an auth method/i.test(normalized)) return normalized;
  if (/(?:API key|authentication).*(?:not set|missing|failed|required)/i.test(normalized)) return normalized;
  return null;
}

export function parseCliOutputLine(line: string): ParsedCliOutput {
  const cleaned = stripAnsi(line).trimEnd();
  if (!cleaned) return { text: "", error: null, terminal: false };

  try {
    const parsed: unknown = JSON.parse(cleaned);
    if (!parsed || typeof parsed !== "object") {
      return { text: "", error: null, terminal: false };
    }
    const event = parsed as Record<string, unknown>;
    if (event.event === "step_update") {
      const step = event.step_update as Record<string, unknown> | undefined;
      return { text: typeof step?.text_delta === "string" ? step.text_delta : "", error: null, terminal: false };
    }
    if (event.event === "result") {
      const result = event.result as Record<string, unknown> | undefined;
      return { text: typeof result?.response === "string" ? result.response : "", error: result?.status === "SUCCESS" ? null : String(result?.error || "Antigravity CLI 未完成"), terminal: true };
    }
    const text = extractJsonEventText(event);
    const terminal = event.type === "turn.completed" || event.type === "result";
    const explicitError =
      event.is_error === true || event.type === "error" || event.error === "authentication_failed";
    const errorText = explicitError
      ? text || (typeof event.error === "string" ? event.error : "本地 Agent 返回错误")
      : configurationError(text);
    return { text: errorText ? "" : text, error: errorText, terminal };
  } catch {
    const error = configurationError(cleaned);
    return { text: error ? "" : `${cleaned}\n`, error, terminal: false };
  }
}
