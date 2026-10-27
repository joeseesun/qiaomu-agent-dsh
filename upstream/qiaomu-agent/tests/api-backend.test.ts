import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiBackend } from "../src/services/api-backend";
import { DEFAULT_SETTINGS } from "../src/defaults";
import { buildSystemPrompt, RESPONSE_CONVENTIONS } from "../src/services/agent-prompt";
import type { ChatRequest } from "../src/types";

const request: ChatRequest = { prompt: "你好", systemPrompt: "测试", cwd: null, permissionMode: "plan", history: [] };
const callbacks = () => ({ onText: vi.fn(), onStatus: vi.fn() });

describe("API streaming transport", () => {
  it("sends the configured model and streams Chinese text through the real SDK parser", async () => {
    const chunks = [
      { id: "c1", object: "chat.completion.chunk", created: 1, model: "test", choices: [{ index: 0, delta: { role: "assistant", content: "中文" }, finish_reason: null }] },
      { id: "c1", object: "chat.completion.chunk", created: 1, model: "test", choices: [{ index: 0, delta: { content: "回复" }, finish_reason: "stop" }] },
    ];
    const fetcher = vi.fn().mockResolvedValue(new Response(chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } }));
    vi.stubGlobal("fetch", fetcher);
    const cb = callbacks();
    await new ApiBackend({ ...DEFAULT_SETTINGS.api, provider: "siliconflow", model: "test" }, "fake").send({ ...request, systemPrompt: buildSystemPrompt("用中文回答"), modelOptions: { temperature: 0.7, maxOutputTokens: 4096 } }, cb, new AbortController().signal);
    expect(cb.onText.mock.calls.flat().join("")).toBe("中文回复");
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toMatch(/\/chat\/completions$/);
    expect(JSON.parse(init.body).model).toBe("test");
    expect(JSON.parse(init.body).stream).toBe(true);
    expect(JSON.parse(init.body).messages[0].content).toContain(RESPONSE_CONVENTIONS);
    expect(JSON.parse(init.body)).toMatchObject({ temperature: 0.7, max_tokens: 4096 });
  });
  it.each([
    ["none", { thinking: { type: "disabled" } }],
    ["max", { thinking: { type: "enabled" }, reasoning_effort: "max" }],
  ] as const)("encodes DeepSeek reasoning choice %s in the chat request", async (effort, expected) => {
    const chunk = { id: "c1", object: "chat.completion.chunk", created: 1, model: "deepseek-flash", choices: [{ index: 0, delta: { content: "好" }, finish_reason: "stop" }] };
    const fetcher = vi.fn().mockResolvedValue(new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } }));
    vi.stubGlobal("fetch", fetcher);
    await new ApiBackend({ ...DEFAULT_SETTINGS.api, provider: "deepseek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-flash" }, "fake")
      .send({ ...request, reasoningEffort: effort }, callbacks(), new AbortController().signal);
    expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toMatchObject(expected);
  });
  it("does not retry authentication failures", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "Invalid key", type: "authentication_error" } }), { status: 401 }));
    vi.stubGlobal("fetch", fetcher);
    await expect(new ApiBackend(DEFAULT_SETTINGS.api, "fake").send(request, callbacks(), new AbortController().signal)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("never starts a request that was already cancelled", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const controller = new AbortController(); controller.abort();
    await expect(new ApiBackend(DEFAULT_SETTINGS.api, "fake").send(request, callbacks(), controller.signal)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("does not treat a plain chat API as an image editor", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(new ApiBackend({ ...DEFAULT_SETTINGS.api, provider: "doubao", model: "text-model" }, "fake").send({ ...request,
      attachments: [{ id: "reference", name: "reference.png", mediaType: "image/png", size: 2, url: "data:image/png;base64,AA==", intent: "edit" }],
    }, callbacks(), new AbortController().signal)).rejects.toThrow("图片编辑");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("routes OpenAI reference edits through the Responses image tool", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } }));
    vi.stubGlobal("fetch", fetcher);
    const image = { id: "reference", name: "reference.png", mediaType: "image/png", size: 3, url: "data:image/png;base64,AQID", intent: "edit" as const };
    await new ApiBackend({ ...DEFAULT_SETTINGS.api, provider: "openai", model: "gpt-5.5" }, "fake").send({ ...request, attachments: [image] }, callbacks(), new AbortController().signal).catch(() => {});
    const [url, init] = fetcher.mock.calls[0]!;
    const body = JSON.parse(init.body);
    expect(String(url)).toMatch(/\/responses$/);
    expect(body.tools).toContainEqual(expect.objectContaining({ type: "image_generation", action: "edit", model: "gpt-image-2.5-sunburst" }));
    expect(JSON.stringify(body.input)).toContain("data:image/png;base64,AQID");
  });
  it("requests image output only from a Gemini image model", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } }));
    vi.stubGlobal("fetch", fetcher);
    const image = { id: "reference", name: "reference.png", mediaType: "image/png", size: 3, url: "data:image/png;base64,AQID", intent: "edit" as const };
    await new ApiBackend({ ...DEFAULT_SETTINGS.api, provider: "google", protocol: "google", baseUrl: "https://generativelanguage.googleapis.com/v1beta", model: "gemini-3.1-flash-image" }, "fake")
      .send({ ...request, attachments: [image] }, callbacks(), new AbortController().signal).catch(() => {});
    const [url, init] = fetcher.mock.calls[0]!;
    const body = JSON.parse(init.body);
    expect(String(url)).toContain("gemini-3.1-flash-image");
    expect(body.generationConfig.responseModalities).toEqual(["TEXT", "IMAGE"]);
    expect(JSON.stringify(body.contents)).toContain("AQID");
  });
});

afterEach(() => vi.unstubAllGlobals());
describe("API discovery transport", () => {
  it("shows the vendor name for DeepSeek's current Flash model", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [
      { id: "deepseek-flash", name: "DeepSeek-V4.1-Flash", context_window: 1_048_576, max_output_tokens: 393_216,
        input_modalities: ["text", "image"], effort: { supported_levels: ["low", "high", "max"], default_level: "high" } },
    ] }))));
    const models = await new ApiBackend({ ...DEFAULT_SETTINGS.api, provider: "deepseek", baseUrl: "https://api.deepseek.com/v1" }, "fake").listModels();
    expect(models[0]).toMatchObject({ id: "deepseek-flash", name: "DeepSeek-V4.1-Flash", contextWindow: 1_048_576,
      maxOutputTokens: 393_216, vision: true, reasoning: true, efforts: ["low", "high", "max"] });
  });
  it.each([
    ["anthropic", "x-api-key"], ["google", "x-goog-api-key"], ["openai-chat", "Authorization"], ["openai-responses", "Authorization"],
  ] as const)("uses %s authentication for custom providers", async (protocol, header) => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ id: "example-model" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    const backend = new ApiBackend({ ...DEFAULT_SETTINGS.api, provider: "custom", protocol }, "test-secret");
    expect((await backend.listModels())[0]?.id).toBe("example-model");
    expect(new Headers(fetcher.mock.calls[0]?.[1].headers).get(header)).toContain("test-secret");
    expect(fetcher.mock.calls[0]?.[1].redirect).toBe("error");
  });
  it("snapshots config and refuses to send secrets over remote HTTP", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const connection = { ...DEFAULT_SETTINGS.api, baseUrl: "http://example.com/v1" };
    const backend = new ApiBackend(connection, "secret");
    connection.baseUrl = "https://example.com/v1";
    await expect(backend.listModels()).rejects.toThrow("HTTPS");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
