import { afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ calls: [] as Array<{ method: string; params: Record<string, unknown> }>, notify: (_m: string, _p: unknown) => {} }));
vi.mock("../src/services/json-rpc-process", () => ({ JsonRpcProcess: class {
  running = true;
  constructor(options: { onNotification: (m: string, p: unknown) => void }) { state.notify = options.onNotification; }
  start() {} notify() {} async stop() {}
  async request(method: string, params: Record<string, unknown>) {
    state.calls.push({ method, params });
    if (method === "thread/start") return { thread: { id: "t1" } };
    if (method === "model/list") return { data: [{ model: "test-model", displayName: "Test", supportedReasoningEfforts: [{ reasoningEffort: "high" }] }] };
    if (method === "turn/start") { queueMicrotask(() => state.notify("turn/completed", { turn: { status: "completed" } })); return { turn: { id: "r1" } }; }
    return {};
  }
} }));
import { NativeAgentBackend } from "../src/services/native-agent-backend";
afterEach(() => { vi.unstubAllGlobals(); state.calls.length = 0; });
it("forwards actual selected model, effort and image to Codex App Server", async () => {
  vi.stubGlobal("window", {});
  const backend = new NativeAgentBackend({ id: "codex", label: "Codex", command: "codex", path: "/test/codex", version: "test", available: true, callable: true });
  const request = { prompt: "hello", systemPrompt: "system", cwd: "/test", permissionMode: "plan" as const, history: [], model: "test-model", reasoningEffort: "high", attachments: [{ id: "i", name: "i.png", mediaType: "image/png", size: 1, url: "data:image/png;base64,AA==" }] };
  expect(await backend.listModels(request)).toMatchObject([{ id: "test-model", efforts: ["high"] }]);
  await backend.send(request, { onText() {}, onStatus() {} }, new AbortController().signal);
  expect(state.calls.find((c) => c.method === "turn/start")?.params).toMatchObject({ model: "test-model", effort: "high", input: [{ type: "text" }, { type: "image", url: "data:image/png;base64,AA==" }] });
});

it("does not surface a persistent connected status after App Server starts", async () => {
  vi.stubGlobal("window", {});
  const status = vi.fn();
  const backend = new NativeAgentBackend({ id: "codex", label: "Codex", command: "codex", path: "/test/codex", version: "test", available: true, callable: true });
  await backend.send({ prompt: "hello", systemPrompt: "system", cwd: "/test", permissionMode: "plan", history: [] }, { onText() {}, onStatus: status }, new AbortController().signal);
  expect(status).not.toHaveBeenCalledWith(expect.stringContaining("已连接"));
});

it.each([
  ["plan", { type: "readOnly" }],
  ["edit", { type: "workspaceWrite", writableRoots: ["/test"], networkAccess: false }],
  ["full", { type: "dangerFullAccess" }],
] as const)("maps %s to the matching Codex App Server sandbox", async (permissionMode, sandboxPolicy) => {
  vi.stubGlobal("window", {});
  const backend = new NativeAgentBackend({ id: "codex", label: "Codex", command: "codex", path: "/test/codex", version: "test", available: true, callable: true });
  await backend.send({ prompt: "hello", systemPrompt: "system", cwd: "/test", permissionMode, history: [] }, { onText() {}, onStatus() {} }, new AbortController().signal);
  expect(state.calls.find((c) => c.method === "turn/start")?.params).toMatchObject({ cwd: "/test", sandboxPolicy });
});
