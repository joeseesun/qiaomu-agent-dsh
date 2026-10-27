import { accountText as t } from "../i18n/accounts";
import { accountObject } from "./account-json";

/** SIWC is a separate capability profile, not an ordinary OpenAI API key. */
export function chatgptBody(body: BodyInit | null | undefined): string {
  if (typeof body !== "string") throw new Error(t("invalid"));
  const data = accountObject(JSON.parse(body) as unknown);
  for (const key of ["background", "conversation", "max_output_tokens", "max_tool_calls", "metadata", "moderation", "multi_agent", "prompt", "prompt_cache_retention", "safety_identifier", "temperature", "top_logprobs", "top_p", "truncation", "user", "previous_response_id"]) delete data[key];
  data.store = false; data.stream = true;
  if (Array.isArray(data.input)) for (const value of data.input as unknown[]) { const item = accountObject(value); if (item.role === "system") item.role = "developer"; }
  const functions: unknown[] = [];
  const tools: unknown[] = [];
  if (data.tools !== undefined && !Array.isArray(data.tools)) throw new Error(t("invalid"));
  for (const value of (data.tools ?? []) as unknown[]) {
    const tool = accountObject(value);
    if (tool.type === "function" || tool.type === "custom") functions.push(tool);
    else if (tool.type === "namespace" || tool.type === "web_search" || tool.type === "web_search_preview") tools.push(tool);
    else throw new Error(t("restricted"));
  }
  if (functions.length) tools.push({ type: "namespace", name: "qiaomu", description: "Qiaomu Agent local tools", tools: functions });
  if (data.tools) data.tools = tools;
  return JSON.stringify(data);
}

/** A cut stream must never be reported as a completed response, even after text arrived. */
export function completeChatGPTStream(response: Response): Response {
  if (!response.body || !response.ok) return response;
  const decoder = new TextDecoder(); let buffer = "", completed = false;
  const lines = (text: string) => {
    buffer += text;
    const parts = buffer.split("\n"); buffer = parts.pop() ?? "";
    for (const line of parts) if (line.startsWith("data:")) {
      try { if (accountObject(JSON.parse(line.slice(5).trim()) as unknown).type === "response.completed") completed = true; } catch { /* keep SDK error handling */ }
    }
  };
  return new Response(response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) { lines(decoder.decode(chunk, { stream: true })); controller.enqueue(chunk); },
    flush() { lines(decoder.decode() + "\n"); if (!completed) throw new Error(t("streamFailed")); },
  })), { status: response.status, headers: response.headers });
}
