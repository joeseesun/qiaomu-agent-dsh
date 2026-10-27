import { expect, it, vi } from "vitest";
import { NativeAgentBackend } from "../src/services/native-agent-backend";
import type { ChatRequest } from "../src/types";

const calls = vi.hoisted(() => [] as Array<{ method: string; params: Record<string, unknown> }>);
vi.mock("../src/services/runtime-require", () => ({ getRuntimeRequire: () => () => ({ env: {} }) }));
vi.mock("../src/services/json-rpc-process", () => ({
  JsonRpcProcess: class {
    running = false;
    start() { this.running = true; }
    async stop() { this.running = false; }
    async request(method: string, params: Record<string, unknown>) {
      calls.push({ method, params });
      if (method === "initialize") return { protocolVersion: 1 };
      if (method === "session/new") return { sessionId: "claude-session", modes: { currentModeId: "bypassPermissions", availableModes: [
        { id: "plan" }, { id: "acceptEdits" }, { id: "bypassPermissions" },
      ] } };
      return {};
    }
  },
}));

const request: ChatRequest = { prompt: "只读问题", systemPrompt: "不要修改文件", cwd: "/tmp/vault", permissionMode: "plan", history: [] };
const detection = { id: "claude", label: "Claude Code", command: "claude", path: "/claude", nativePath: "/node", nativeArgsPrefix: ["/claude-agent-acp"], version: "2.1", available: true, callable: true };

it("sets Claude ACP's permission mode before every prompt that changes it", async () => {
  calls.length = 0;
  const backend = new NativeAgentBackend(detection);
  const callbacks = { onText: vi.fn(), onStatus: vi.fn() };
  await backend.send(request, callbacks, new AbortController().signal);
  await backend.send({ ...request, permissionMode: "edit", prompt: "修改" }, callbacks, new AbortController().signal);
  const methods = calls.map((call) => call.method);
  expect(methods.filter((method) => method === "session/new")).toHaveLength(1);
  expect(methods).toEqual(["initialize", "session/new", "session/set_mode", "session/prompt", "session/set_mode", "session/prompt"]);
  expect(calls.filter((call) => call.method === "session/set_mode").map((call) => call.params.modeId)).toEqual(["plan", "acceptEdits"]);
  await backend.shutdown();
});
