import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiBackend, nativeWebSearchProvider, withBodyExtras } from "../src/services/api-backend";
import { DEFAULT_SETTINGS } from "../src/defaults";

vi.mock("../src/services/web-page", () => ({ readWebPage: vi.fn().mockResolvedValue({ url: "https://example.com/article", title: "Example", text: "Article body" }) }));

describe("API webpage tool", () => {
  it("offers native search only on documented vendor endpoints", () => {
    expect(nativeWebSearchProvider("openai", "openai-chat")).toBe("openai-responses");
    expect(nativeWebSearchProvider("xai", "openai-chat")).toBe("openai-responses");
    expect(nativeWebSearchProvider("anthropic", "anthropic")).toBe("anthropic");
    expect(nativeWebSearchProvider("google", "google")).toBe("google");
    expect(nativeWebSearchProvider("openrouter", "openai-chat")).toBe("openrouter");
    expect(nativeWebSearchProvider("deepseek", "openai-chat")).toBeNull();
    expect(nativeWebSearchProvider("custom", "openai-responses")).toBeNull();
  });
  it("keeps client tools when an OpenRouter server tool is added", () => {
    expect(JSON.parse(withBodyExtras('{"tools":[{"type":"function","function":{"name":"search_vault"}}]}', { tools: [{ type: "openrouter:web_search" }] }) as string).tools)
      .toEqual([{ type: "function", function: { name: "search_vault" } }, { type: "openrouter:web_search" }]);
  });
  it.each([
    ["openai", "openai-chat", "web_search", "/responses"],
    ["xai", "openai-chat", "web_search", "/responses"],
    ["anthropic", "anthropic", "web_search_20250305", "/messages"],
    ["google", "google", "googleSearch", ":streamGenerateContent"],
    ["deepseek", "openai-chat", "search_web", "/chat/completions"],
  ])("sends a search tool for %s", async (provider, protocol, toolType, endpoint) => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetcher = vi.fn().mockResolvedValue(new Response("request rejected", { status: 400 }));
    vi.stubGlobal("fetch", fetcher);
    await new ApiBackend({ ...DEFAULT_SETTINGS.api, provider, protocol: protocol as "openai-chat" | "anthropic" | "google", model: provider === "google" ? "gemini-2.5-flash" : "test" }, "fake", "brave-key")
      .send({ prompt: "搜索最新消息", systemPrompt: "", cwd: null, permissionMode: "plan", history: [] }, { onText: vi.fn(), onStatus: vi.fn() }, new AbortController().signal)
      .catch(() => {});
    expect(fetcher).toHaveBeenCalled();
    expect(String(fetcher.mock.calls[0]![0])).toContain(endpoint);
    expect(JSON.stringify(JSON.parse(fetcher.mock.calls[0]![1].body).tools)).toContain(toolType);
    errorLog.mockRestore();
  });
  it.each([
    ["openai", "openai-chat"], ["anthropic", "anthropic"], ["openrouter", "openai-chat"], ["deepseek", "openai-chat"],
  ])("sends no search tool for %s when web search is off", async (provider, protocol) => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetcher = vi.fn().mockResolvedValue(new Response("request rejected", { status: 400 }));
    vi.stubGlobal("fetch", fetcher);
    await new ApiBackend({ ...DEFAULT_SETTINGS.api, provider, protocol: protocol as "openai-chat" | "anthropic", model: "test" }, "fake", "brave-key")
      .send({ prompt: "搜索最新消息", systemPrompt: "", cwd: null, permissionMode: "plan", webSearch: false, history: [] }, { onText: vi.fn(), onStatus: vi.fn() }, new AbortController().signal)
      .catch(() => {});
    const body = JSON.stringify(JSON.parse(fetcher.mock.calls[0]![1].body));
    expect(body).not.toMatch(/web_search|search_web|openrouter:web/);
    expect(body).toContain("用户已关闭联网搜索");
    errorLog.mockRestore();
  });
  it("uses OpenRouter's server search without another search key", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetcher = vi.fn().mockResolvedValue(new Response("request rejected", { status: 400 }));
    vi.stubGlobal("fetch", fetcher);
    await new ApiBackend({ ...DEFAULT_SETTINGS.api, provider: "openrouter", model: "deepseek/deepseek-chat" }, "fake")
      .send({ prompt: "搜一下最新消息", systemPrompt: "", cwd: null, permissionMode: "plan", history: [] }, { onText: vi.fn(), onStatus: vi.fn() }, new AbortController().signal)
      .catch(() => {});
    expect(JSON.parse(fetcher.mock.calls[0]![1].body).tools).toEqual([
      { type: "openrouter:web_search", parameters: { max_results: 5, max_total_results: 10 } },
      { type: "openrouter:web_fetch" },
    ]);
    errorLog.mockRestore();
  });
  it("reads the URL and lets the model answer in a second step", async () => {
    vi.stubGlobal("window", { require: () => ({}) });
    const events = [
      [{ id: "one", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: "call-1", type: "function", function: { name: "read_web_page", arguments: '{"url":"https://example.com/article"}' } }] }, finish_reason: "tool_calls" }] }],
      [{ id: "two", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", content: "文章正文已读取" }, finish_reason: "stop" }] }],
    ];
    const fetcher = vi.fn().mockImplementation(async () => new Response(events.shift()!.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } }));
    vi.stubGlobal("fetch", fetcher);
    const onText = vi.fn();
    await new ApiBackend({ ...DEFAULT_SETTINGS.api, provider: "deepseek", model: "deepseek-flash" }, "fake").send({
      prompt: "读一下 https://example.com/article", systemPrompt: "测试", cwd: null, permissionMode: "plan", history: [],
    }, { onText, onStatus: vi.fn() }, new AbortController().signal);
    expect(onText.mock.calls.flat().join("")).toBe("文章正文已读取");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetcher.mock.calls[0]![1].body).tools[0].function.name).toBe("read_web_page");
    expect(JSON.stringify(JSON.parse(fetcher.mock.calls[1]![1].body).messages)).toContain("Article body");
  });
  it.each([
    ["plan", ["read_vault_note", "search_vault"]],
    ["edit", ["delete_path", "edit_file", "list_dir", "read_vault_note", "search_vault", "write_file"]],
  ])("sends the file tools the %s permission allows", async (permissionMode, names) => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetcher = vi.fn().mockResolvedValue(new Response("request rejected", { status: 400 }));
    vi.stubGlobal("fetch", fetcher);
    await new ApiBackend({ ...DEFAULT_SETTINGS.api, provider: "deepseek", model: "deepseek-chat" }, "fake", "", { vault: { adapter: {} } } as never)
      .send({ prompt: "整理笔记", systemPrompt: "", cwd: "/vault", permissionMode: permissionMode as "plan" | "edit", history: [] }, { onText: vi.fn(), onStatus: vi.fn() }, new AbortController().signal)
      .catch(() => {});
    const body = JSON.parse(fetcher.mock.calls[0]![1].body);
    expect(body.tools.map((t: { function: { name: string } }) => t.function.name).sort()).toEqual(names);
    expect(body.messages[0].content.includes("直接修改当前 Obsidian 仓库")).toBe(permissionMode === "edit");
    errorLog.mockRestore();
  });
});

afterEach(() => vi.unstubAllGlobals());
