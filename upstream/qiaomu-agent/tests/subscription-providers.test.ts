import { afterEach, expect, it, vi } from "vitest";
import { ApiBackend } from "../src/services/api-backend";
import { API_PROVIDERS } from "../src/services/api-providers";
import { chatgptBody, completeChatGPTStream } from "../src/services/chatgpt-transport";
import { DEFAULT_SETTINGS } from "../src/defaults";
import type { App } from "obsidian";
afterEach(() => vi.unstubAllGlobals());

it("discovers Magpie subscriptions with original ids and all reported effort levels", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ name: "magpie", version: "test" }))).mockResolvedValueOnce(new Response(JSON.stringify({ data: [
    { id: "claude/claude-sonnet-5", display_name: "Claude Sonnet", reasoning: true, supported_reasoning_levels: [{ effort: "high" }, { effort: "max" }], modalities: ["text", "image"], context_window: 200000 },
  ] })));
  vi.stubGlobal("fetch", fetcher);
  const models = await new ApiBackend({ ...DEFAULT_SETTINGS.api, provider: "magpie", baseUrl: API_PROVIDERS.magpie!.baseUrl }, "").listModels();
  expect(models[0]).toMatchObject({ id: "claude/claude-sonnet-5", vision: true, reasoning: true, efforts: ["high", "max"], contextWindow: 200000 });
  expect(fetcher.mock.calls[0]![0]).toBe("http://127.0.0.1:3425/api/hello");
  expect(new Headers(fetcher.mock.calls[1]![1].headers).get("Authorization")).toBe("Bearer magpie-qiaomu-agent");
});

it("does not mistake another local server for Magpie", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ name: "other" }))));
  await expect(new ApiBackend({ ...DEFAULT_SETTINGS.api, provider: "magpie", baseUrl: API_PROVIDERS.magpie!.baseUrl }, "").listModels()).rejects.toThrow("Magpie");
});

it("lists only account-visible ChatGPT models from the SIWC catalog", async () => {
  const raw = JSON.stringify({ version: 1, clientId: "client", subject: "user", access: "access", refresh: "refresh", expires: Date.now() + 3600000, scopes: ["chatgpt.tokens.use.direct"] });
  const app = { secretStorage: { getSecret: () => raw, setSecret: vi.fn() } } as unknown as App;
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ models: [
    { slug: "visible", display_name: "Visible", visibility: "list" }, { slug: "hidden", visibility: "hide" },
  ] }))));
  const models = await new ApiBackend({ ...DEFAULT_SETTINGS.api, provider: "chatgpt", baseUrl: API_PROVIDERS.chatgpt!.baseUrl }, raw, "", app).listModels();
  expect(models.map(m => m.id)).toEqual(["visible"]);
});

it("prepares a subscription request without unsupported parameters and with local tool namespaces", () => {
  const data = JSON.parse(chatgptBody(JSON.stringify({ store: true, stream: false, max_output_tokens: 1024, temperature: .5, previous_response_id: "old", input: [{ role: "system", content: "hi" }], tools: [{ type: "function", name: "read_vault_note", parameters: {} }] })));
  expect(data).toMatchObject({ store: false, stream: true, input: [{ role: "developer" }], tools: [{ type: "namespace", name: "qiaomu", tools: [{ name: "read_vault_note" }] }] });
  expect(data).not.toHaveProperty("temperature"); expect(data).not.toHaveProperty("max_output_tokens"); expect(data).not.toHaveProperty("previous_response_id");
});

it("detects truncated ChatGPT streams even when text arrived", async () => {
  await expect(completeChatGPTStream(new Response('data: {"type":"response.output_text.delta","delta":"partial"}\n\n')).text()).rejects.toThrow();
  expect(await completeChatGPTStream(new Response('data: {"type":"response.completed"}\n\n')).text()).toContain("response.completed");
});

const sse = (events: unknown[]) => new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
const question = JSON.stringify({ questions: [{ id: "style", question: "选哪种风格？", options: [{ label: "简洁" }, { label: "详细" }] }] });

it("round-trips a Claude subscription tool call through Magpie with the real SDK", async () => {
  const fetcher = vi.fn()
    .mockResolvedValueOnce(sse([{ id: "one", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: "call-1", type: "function", function: { name: "ask_user", arguments: question } }] }, finish_reason: "tool_calls" }] }]))
    .mockResolvedValueOnce(sse([{ id: "two", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", content: "已采用简洁风格" }, finish_reason: "stop" }] }]));
  vi.stubGlobal("fetch", fetcher);
  const onText = vi.fn(), requestUserInput = vi.fn().mockImplementation(async request => ({ [request.questions[0].id]: ["简洁"] }));
  await new ApiBackend({ ...DEFAULT_SETTINGS.api, provider: "magpie", baseUrl: API_PROVIDERS.magpie!.baseUrl, model: "claude/claude-sonnet-5" }, "").send({ prompt: "写一篇文章", systemPrompt: "", cwd: null, permissionMode: "plan", webSearch: false, history: [], reasoningEffort: "max" }, { onText, onStatus: vi.fn(), requestUserInput }, new AbortController().signal);
  expect(requestUserInput).toHaveBeenCalledOnce();
  expect(onText.mock.calls.flat().join("")).toBe("已采用简洁风格");
  expect(fetcher).toHaveBeenCalledTimes(2);
  const first = JSON.parse(fetcher.mock.calls[0]![1].body), second = JSON.parse(fetcher.mock.calls[1]![1].body);
  expect(first).toMatchObject({ model: "claude/claude-sonnet-5", reasoning_effort: "max" });
  expect(second.messages).toContainEqual(expect.objectContaining({ role: "tool", tool_call_id: "call-1", content: expect.stringContaining("简洁") }));
});

it("round-trips a namespaced ChatGPT tool and preserves its namespace on the next turn", async () => {
  const item = { type: "function_call", id: "fc_1", call_id: "call-1", name: "ask_user", namespace: "qiaomu", arguments: question, status: "completed" };
  const fetcher = vi.fn()
    .mockResolvedValueOnce(sse([{ type: "response.output_item.added", output_index: 0, item }, { type: "response.output_item.done", output_index: 0, item }, { type: "response.completed", response: {} }]))
    .mockResolvedValueOnce(sse([{ type: "response.output_item.added", output_index: 0, item: { type: "message", id: "msg_1", role: "assistant", content: [] } }, { type: "response.output_text.delta", item_id: "msg_1", output_index: 0, content_index: 0, delta: "收到" }, { type: "response.output_item.done", output_index: 0, item: { type: "message", id: "msg_1" } }, { type: "response.completed", response: {} }]));
  vi.stubGlobal("fetch", fetcher);
  const raw = JSON.stringify({ version: 1, clientId: "client", subject: "user", access: "access", refresh: "refresh", expires: Date.now() + 3600000, scopes: ["chatgpt.tokens.use.direct"] });
  const app = { secretStorage: { getSecret: () => raw, setSecret: vi.fn() } } as unknown as App;
  const onText = vi.fn(), requestUserInput = vi.fn().mockImplementation(async request => ({ [request.questions[0].id]: ["简洁"] }));
  await new ApiBackend({ ...DEFAULT_SETTINGS.api, provider: "chatgpt", baseUrl: API_PROVIDERS.chatgpt!.baseUrl, model: "test" }, raw, "", app).send({ prompt: "帮我写", systemPrompt: "test", cwd: null, permissionMode: "plan", history: [], webSearch: false }, { onText, onStatus: vi.fn(), requestUserInput }, new AbortController().signal);
  expect(requestUserInput).toHaveBeenCalledOnce();
  expect(onText.mock.calls.flat().join("")).toBe("收到");
  expect(fetcher).toHaveBeenCalledTimes(2);
  const second = JSON.parse(fetcher.mock.calls[1]![1].body);
  expect(second).toMatchObject({ store: false, stream: true });
  expect(second.input).toContainEqual(expect.objectContaining({ type: "function_call", name: "ask_user", namespace: "qiaomu" }));
  expect(second.input).toContainEqual(expect.objectContaining({ type: "function_call_output", call_id: "call-1", output: expect.stringContaining("简洁") }));
});
