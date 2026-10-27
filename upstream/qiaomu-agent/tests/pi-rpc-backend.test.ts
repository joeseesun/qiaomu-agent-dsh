import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PiRpcBackend } from "../src/services/pi-rpc-backend";
import type { ChatRequest, CliDetection } from "../src/types";

const mock = vi.hoisted(() => ({ spawn: vi.fn(), execFile: vi.fn(), piProcessEnv: vi.fn(), env: {} as Record<string, string>, commands: [] as string[], messages: [] as string[] }));
vi.mock("../src/services/runtime-require", () => ({ getRuntimeRequire: () => (name: string) => name === "child_process" ? { spawn: mock.spawn, execFile: mock.execFile } : { env: {} } }));
vi.mock("../src/services/pi-process-env", () => ({ piProcessEnv: mock.piProcessEnv }));
beforeEach(() => {
  mock.env = {};
  mock.messages = [];
  mock.piProcessEnv.mockImplementation(async () => ({ ...mock.env }));
});
afterEach(() => vi.clearAllMocks());

const request: ChatRequest = { prompt: "你好", systemPrompt: "保留双链", cwd: "/tmp/vault", permissionMode: "plan", history: [] };
const detection: CliDetection = { id: "pi", label: "Pi", command: "pi", path: "/pi", version: "0.87.1", available: true, callable: true };

it.each([
  ["直接运行 Pi", detection],
  ["通过 Node 运行 Pi", { ...detection, path: "/nvm/bin/node", argsPrefix: ["/nvm/bin/pi"] }],
])("%s 时复用 RPC 进程并流式返回文本", async (_label, launch) => {
  mock.commands = [];
  mock.spawn.mockImplementation((_path: string, args: string[]) => {
    expect(_path).toBe(launch.path);
    expect(args.slice(0, (launch.argsPrefix?.length ?? 0) + 1)).toEqual([...(launch.argsPrefix ?? []), "--mode"]);
    expect(args).toContain("rpc");
    expect(args).toContain("read,grep,find,ls");
    const listeners: Record<string, (...args: unknown[]) => void> = {};
    const child = {
      exitCode: null, killed: false,
      stdout: { on: (_event: string, listener: (...args: unknown[]) => void) => { listeners.stdout = listener; } },
      stderr: { on: vi.fn() }, on: vi.fn(), kill: vi.fn(),
      stdin: { writable: true, end: vi.fn(), write(data: string) {
        const command = JSON.parse(data) as { id: string; type: string; message?: string };
        mock.commands.push(command.type);
        if (command.message) mock.messages.push(command.message);
        queueMicrotask(() => {
          listeners.stdout?.(new TextEncoder().encode(`${JSON.stringify({ type: "response", id: command.id, command: command.type, success: true, data: { disposition: "started" } })}\n`));
          if (command.type === "prompt") {
            listeners.stdout?.(new TextEncoder().encode(`${JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "好" } })}\n`));
            listeners.stdout?.(new TextEncoder().encode('{"type":"agent_settled"}\n'));
          }
        });
      } },
    };
    return child;
  });
  const backend = new PiRpcBackend(launch);
  const onText = vi.fn();
  await backend.prepare(request);
  expect(mock.commands).toEqual([]);
  await backend.send(request, { onText, onStatus: vi.fn() }, new AbortController().signal);
  await backend.send({ ...request, prompt: "继续" }, { onText, onStatus: vi.fn() }, new AbortController().signal);
  expect(mock.spawn).toHaveBeenCalledTimes(1);
  expect(mock.commands).toEqual(["prompt", "prompt"]);
  expect(onText).toHaveBeenCalledTimes(2);
  mock.env = { HTTPS_PROXY: "http://proxy.example:9032" };
  await backend.send({ ...request, history: [{ id: "1", createdAt: 0, role: "user", content: "上一轮用户问题" }, { id: "2", createdAt: 0, role: "assistant", content: "上一轮回答" }] },
    { onText, onStatus: vi.fn() }, new AbortController().signal);
  expect(mock.spawn).toHaveBeenCalledTimes(2);
  expect(mock.spawn.mock.calls[1]?.[2]).toMatchObject({ env: mock.env });
  expect(mock.messages.at(-1)).toContain("上一轮用户问题");
  expect(mock.messages.at(-1)).toContain("上一轮回答");
  backend.resetSession();
  await backend.send(request, { onText, onStatus: vi.fn() }, new AbortController().signal);
  expect(mock.commands.slice(-2)).toEqual(["new_session", "prompt"]);
  await backend.shutdown();
});

it("通过检测到的 Node 运行 Pi 获取模型列表", async () => {
  mock.env = { HTTPS_PROXY: "http://proxy.example:8421" };
  mock.execFile.mockImplementation((_path: string, _args: string[], _options: unknown, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
    callback(null, "provider  model\nopenai  gpt-5\n", "");
  });
  const backend = new PiRpcBackend({ ...detection, path: "/nvm/bin/node", argsPrefix: ["/nvm/bin/pi"] });
  expect(await backend.listModels()).toMatchObject([{ id: "openai/gpt-5" }]);
  expect(mock.execFile).toHaveBeenCalledWith("/nvm/bin/node", ["/nvm/bin/pi", "--list-models"], expect.objectContaining({ env: mock.env }), expect.any(Function));
});

it("读取代理配置期间取消消息后不再启动 Pi", async () => {
  let resolveEnv!: (env: Record<string, string>) => void;
  mock.piProcessEnv.mockImplementationOnce(() => new Promise<Record<string, string>>((resolve) => { resolveEnv = resolve; }));
  const backend = new PiRpcBackend(detection);
  const controller = new AbortController();
  const sent = backend.send(request, { onText: vi.fn(), onStatus: vi.fn() }, controller.signal);
  controller.abort();
  resolveEnv({});
  await expect(sent).rejects.toMatchObject({ name: "AbortError" });
  expect(mock.spawn).not.toHaveBeenCalled();
});
