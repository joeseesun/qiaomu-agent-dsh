import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { JsonRpcProcessOptions } from "../src/services/json-rpc-process";
import type { ChatRequest } from "../src/types";

const state = vi.hoisted(() => ({
  processes: [] as Array<{ options: JsonRpcProcessOptions; running: boolean; stop: ReturnType<typeof vi.fn> }>,
  calls: [] as Array<{ method: string; params: Record<string, unknown> }>,
  initialize: (() => Promise.resolve({})) as () => Promise<unknown>,
}));
vi.mock("../src/services/json-rpc-process", () => ({ JsonRpcProcess: class {
  running = false;
  constructor(readonly options: JsonRpcProcessOptions) { state.processes.push(this); }
  start() { this.running = true; }
  notify() { if (!this.running) throw new Error("closed"); }
  stop = vi.fn(async () => { this.running = false; });
  async request(method: string, params: Record<string, unknown>) {
    state.calls.push({ method, params });
    if (method === "initialize") return state.initialize();
    if (method === "thread/start") return { thread: { id: "thread" } };
    if (method === "model/list") return { data: [] };
    if (method === "turn/start") {
      queueMicrotask(() => this.options.onNotification?.("turn/completed", { turn: { status: "completed" } }));
      return { turn: { id: "turn" } };
    }
    return {};
  }
} }));
import { NativeAgentBackend } from "../src/services/native-agent-backend";
const request: ChatRequest = { prompt: "hello", systemPrompt: "system instructions", cwd: "/test", permissionMode: "plan", history: [], model: "selected-model" };
const callbacks = { onText: vi.fn(), onStatus: vi.fn() };
const create = () => new NativeAgentBackend({ id: "codex", label: "Codex", command: "codex", path: "/test/codex", version: "test", available: true, callable: true });
const send = (backend: NativeAgentBackend, input = request) => backend.send(input, callbacks, new AbortController().signal);
function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<unknown>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
beforeEach(() => { vi.stubGlobal("window", {}); });
afterEach(() => { vi.unstubAllGlobals(); state.processes.length = 0; state.calls.length = 0; state.initialize = async () => ({}); vi.clearAllMocks(); });

it("shares a delayed startup across preparation, model discovery and sending", async () => {
  const gate = deferred(); state.initialize = () => gate.promise;
  const backend = create();
  const prepare = backend.prepare(request);
  const models = backend.listModels(request);
  const reply = send(backend);
  expect(state.processes).toHaveLength(1);
  expect(state.calls.map(c => c.method)).toEqual(["initialize"]);
  gate.resolve({});
  await Promise.all([prepare, models, reply]);
  expect(state.processes).toHaveLength(1);
  expect(state.calls.filter(c => c.method === "initialize")).toHaveLength(1);
});

it("warms only the transport and keeps it for follow-ups and new conversations", async () => {
  const backend = create();
  await backend.prepare(request);
  expect(state.calls.map(c => c.method)).toEqual(["initialize"]);
  await send(backend); await send(backend);
  expect(state.calls.filter(c => c.method === "thread/start")).toHaveLength(1);
  backend.resetSession(); await send(backend);
  expect(state.calls.filter(c => c.method === "thread/start")).toHaveLength(2);
  expect(state.processes).toHaveLength(1);
  await backend.shutdown();
  expect(state.processes[0]!.stop).toHaveBeenCalledOnce();
});

it("stops failed initialization and retries on the next send", async () => {
  state.initialize = async () => { throw new Error("init failed"); };
  const backend = create();
  await expect(backend.prepare(request)).rejects.toThrow("init failed");
  expect(state.processes[0]!.stop).toHaveBeenCalledOnce();
  state.initialize = async () => ({});
  await send(backend);
  expect(state.processes).toHaveLength(2);
});

it("closing during preparation cannot revive the closed process", async () => {
  const gate = deferred(); state.initialize = () => gate.promise;
  const backend = create();
  const pending = backend.prepare(request);
  const rejected = expect(pending).rejects.toThrow();
  await backend.shutdown(); gate.resolve({}); await rejected;
  expect(state.processes.every(p => !p.running)).toBe(true);
  expect(state.calls.map(c => c.method)).toEqual(["initialize"]);
});

it("sends system instructions once while retaining restored conversation history", async () => {
  const backend = create();
  await send(backend, { ...request, history: [{ id: "previous", role: "user", content: "remember this", createdAt: 1 }] });
  const thread = state.calls.find(c => c.method === "thread/start")!;
  const turn = state.calls.find(c => c.method === "turn/start")!;
  expect(thread.params).toMatchObject({ model: "selected-model", developerInstructions: request.systemPrompt });
  expect(JSON.stringify(turn.params.input)).not.toContain(request.systemPrompt);
  expect(JSON.stringify(turn.params.input)).toContain("remember this");
  await send(backend);
  expect(JSON.stringify(state.calls.filter(c => c.method === "turn/start")[1]!.params.input)).not.toContain("prior_conversation");
});

it("reconnects after a crash, restores history, and ignores stale close events", async () => {
  const backend = create(); await send(backend);
  const old = state.processes[0]!; old.running = false;
  old.options.onClose?.("crashed");
  await send(backend, { ...request, history: [{ id: "previous", role: "assistant", content: "previous reply", createdAt: 1 }] });
  expect(state.processes).toHaveLength(2);
  expect(JSON.stringify(state.calls.filter(c => c.method === "turn/start")[1]!.params.input)).toContain("previous reply");
  old.options.onClose?.("late exit");
  await send(backend);
  expect(state.processes).toHaveLength(2);
  expect(state.calls.filter(c => c.method === "thread/start")).toHaveLength(2);
});

it("does not start a process for an already cancelled send", async () => {
  const controller = new AbortController(); controller.abort();
  await expect(create().send(request, callbacks, controller.signal)).rejects.toThrow();
  expect(state.processes).toHaveLength(0);
});
