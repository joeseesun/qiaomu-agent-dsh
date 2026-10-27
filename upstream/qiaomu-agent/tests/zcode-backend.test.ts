import { afterEach, expect, it, vi } from "vitest";
import { ZcodeBackend, zcodeArgs, zcodeResponse, zcodeError } from "../src/services/zcode-backend";
import type { ChatRequest } from "../src/types";
const mocks = vi.hoisted(() => ({ execFile: vi.fn() }));
vi.mock("../src/services/runtime-require", () => ({ getRuntimeRequire: () => (id: string) => id === "process" ? { env: { PATH: "/bin" } } : { execFile: mocks.execFile } }));
afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });
const request: ChatRequest = { prompt: "你好", systemPrompt: "保留双链", cwd: "/test vault", permissionMode: "plan", history: [] };
const detection = { id: "zcode", label: "ZCode", command: "zcode", path: "/node", argsPrefix: ["/ZCode.app/zcode.cjs"], env: { ZCODE_BUILTIN_PROVIDER_CONFIG_FILE: "/config" }, version: "0.16.9", available: true, callable: true };
it("explicitly maps all permissions, never relies on the dangerous default", () => {
  for (const [permissionMode, mode] of [["plan", "plan"], ["edit", "edit"], ["full", "yolo"]] as const) {
    const args = zcodeArgs({ ...request, permissionMode });
    expect(args[args.indexOf("--mode") + 1]).toBe(mode);
    expect(args).toContain("/test vault");
  }
  expect(() => zcodeArgs({ ...request, model: "unsupported" })).toThrow("ZCode 中选择模型");
});
it("parses a pretty printed JSON result without dumping metadata, rejects malformed and failed output", () => {
  expect(zcodeResponse(JSON.stringify({ response: "第一行\n第二行", sessionId: "secret" }, null, 2))).toBe("第一行\n第二行");
  for (const value of ["null", "{}", "broken", '{"response":"failed","projection":{"status":"failed"}}']) expect(() => zcodeResponse(value)).toThrow();
  expect(zcodeError("ProviderBusinessError: [1309] expired\nset-cookie: secret", "failed")).toContain("套餐已到期");
  expect(zcodeError("Error: failure\nset-cookie: secret", "failed")).not.toContain("secret");
});
it("uses the bundled runtime and env, sends context and emits only the final response", async () => {
  mocks.execFile.mockImplementation((_cmd, _args, _opts, done) => { queueMicrotask(() => done(null, '{"response":"好的"}', "")); return { kill: vi.fn() }; });
  const onText = vi.fn();
  await new ZcodeBackend(detection).send({ ...request, history: [{ id: "1", role: "user", content: "前文", createdAt: 1 }] }, { onText, onStatus: vi.fn() }, new AbortController().signal);
  expect(mocks.execFile.mock.calls[0]?.[0]).toBe("/node");
  expect(mocks.execFile.mock.calls[0]?.[1][0]).toBe("/ZCode.app/zcode.cjs");
  expect(mocks.execFile.mock.calls[0]?.[1].join(" ")).toContain("前文");
  expect(mocks.execFile.mock.calls[0]?.[2].env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE).toBe("/config");
  expect(onText).toHaveBeenCalledExactlyOnceWith("好的");
});
it("cancellation kills a running process and never emits its late response", async () => {
  const controller = new AbortController();
  const kill = vi.fn(); let done!: (error: Error | null, stdout: string, stderr: string) => void;
  mocks.execFile.mockImplementation((_cmd, _args, _opts, callback) => { done = callback; return { kill }; });
  const onText = vi.fn();
  const promise = new ZcodeBackend(detection).send(request, { onText, onStatus: vi.fn() }, controller.signal);
  const check = expect(promise).rejects.toMatchObject({ name: "AbortError" });
  controller.abort(); done(null, '{"response":"late"}', "");
  await check;
  expect(kill).toHaveBeenCalledWith("SIGTERM"); expect(onText).not.toHaveBeenCalled();
});
it("pre-cancelled requests never start a process", async () => {
  const controller = new AbortController(); controller.abort();
  await expect(new ZcodeBackend(detection).send(request, { onText: vi.fn(), onStatus: vi.fn() }, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(mocks.execFile).not.toHaveBeenCalled();
});
