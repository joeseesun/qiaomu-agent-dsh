import { expect, it, vi } from "vitest";
import { ZcodeAppServer } from "../src/services/zcode-app-server";
import type { ChatRequest } from "../src/types";

const state = vi.hoisted(() => ({ calls: [] as string[], notifications: [] as string[], failTurn: false, options: null as null | { onNotification: (method: string, params: unknown) => void; onServerRequest: (id: string, method: string, params: unknown) => void } }));
vi.mock("../src/services/runtime-require", () => ({ getRuntimeRequire: () => () => ({ env: {} }) }));
vi.mock("../src/services/json-rpc-process", () => ({
  JsonRpcProcess: class {
    running = false;
    constructor(options: typeof state.options) { state.options = options; }
    start() { this.running = true; }
    async stop() { this.running = false; }
    notify(method: string) { state.notifications.push(method); }
    respond(_id: string, result: unknown) { state.calls.push(`reply:${JSON.stringify(result)}`); }
    reject() { /* not used */ }
    async request(method: string, params: Record<string, unknown>) {
      state.calls.push(method);
      if (method === "session/create") {
        state.options?.onServerRequest("server-1", "session/requestRuntimePreferences", {});
        return { session: { sessionId: "session-1" } };
      }
      if (method === "session/subscribe") return { eventSeq: 1 };
      if (method === "session/send") {
        const event = { sessionId: params.sessionId, type: "model.streaming", payload: { kind: "text_delta", delta: "早" } };
        state.options?.onNotification("session/event", event);
        queueMicrotask(() => state.options?.onNotification("session/event", { sessionId: params.sessionId, type: state.failTurn ? "turn.failed" : "turn.completed", payload: state.failTurn ? { error: { message: "失败" } } : {} }));
        return { accepted: true };
      }
      return {};
    }
  },
}));

const request: ChatRequest = { prompt: "你好", systemPrompt: "保留双链", cwd: "/tmp/vault", permissionMode: "plan", history: [] };
const detection = { id: "zcode", label: "ZCode", command: "zcode", path: "/node", nativePath: "/node", argsPrefix: ["/zcode.cjs"], version: "0.16.9", available: true, callable: true };

it("streams ZCode events and reuses one subscribed session", async () => {
  state.calls = []; state.notifications = []; state.failTurn = false;
  const backend = new ZcodeAppServer(detection);
  const onText = vi.fn();
  await backend.prepare(request);
  expect(state.calls).toEqual([]);
  await backend.send(request, { onText, onStatus: vi.fn() }, new AbortController().signal);
  await backend.send({ ...request, prompt: "继续" }, { onText, onStatus: vi.fn() }, new AbortController().signal);
  expect(onText).toHaveBeenCalledTimes(2);
  expect(state.calls.filter((method) => method === "session/create")).toHaveLength(1);
  expect(state.calls.filter((method) => method === "session/subscribe")).toHaveLength(1);
  expect(state.calls.some((call) => call.includes("nativeSearchEnhancementsEnabled"))).toBe(true);
  await backend.shutdown();
});

it("does not replay an accepted prompt after a native turn failure", async () => {
  state.calls = []; state.failTurn = true;
  const backend = new ZcodeAppServer(detection);
  await expect(backend.send(request, { onText: vi.fn(), onStatus: vi.fn() }, new AbortController().signal)).rejects.toThrow("失败");
  expect(backend.canFallback).toBe(false);
  await backend.shutdown();
});
