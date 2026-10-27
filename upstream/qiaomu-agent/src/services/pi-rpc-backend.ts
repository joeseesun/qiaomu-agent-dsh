import { getCliProcesses } from "./cli-process";
import type { ChatBackend, ChatCallbacks, ChatRequest, CliDetection, ModelChoice, PermissionMode } from "../types";
import { promptWithContext } from "./cli-profiles";
import { CliBackend } from "./cli-backend";
import { splitJsonLines } from "./json-rpc-process";
import { getRuntimeRequire } from "./runtime-require";
import { piProcessEnv } from "./pi-process-env";

interface Child {
  stdin: { writable: boolean; write(data: string): void; end(): void };
  stdout: { on(event: "data", listener: (chunk: Uint8Array) => void): void };
  stderr: { on(event: "data", listener: (chunk: Uint8Array) => void): void };
  on(event: "error" | "exit", listener: (...args: never[]) => void): void;
  kill(signal?: string): boolean;
  exitCode: number | null;
  killed: boolean;
}
type Message = Record<string, unknown>;
const object = (value: unknown): Message => value && typeof value === "object" && !Array.isArray(value) ? value as Message : {};

/** Pi's documented JSONL RPC keeps the model and session warm between turns. */
export class PiRpcBackend implements ChatBackend {
  readonly id = "cli:pi";
  readonly label = "Pi · RPC";
  private child: Child | null = null;
  private signature = "";
  private buffer = "";
  private decoder = new TextDecoder();
  private stderrTail = "";
  private nextId = 1;
  private pending = new Map<string, { resolve: (value: Message) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private callbacks: ChatCallbacks | null = null;
  private turnResolve: (() => void) | null = null;
  private turnReject: ((error: Error) => void) | null = null;
  private resetNeeded = false;
  private prompted = false;
  private connecting: Promise<void> | null = null;
  private generation = 0;

  constructor(private readonly detection: CliDetection) {}

  async prepare(request: ChatRequest): Promise<void> { await this.ensureConnected(request); }

  listModels(): Promise<ModelChoice[]> { return new CliBackend(this.detection).listModels(); }
  resetSession(): void { this.resetNeeded = true; this.prompted = false; }

  async shutdown(): Promise<void> {
    this.generation++;
    const child = this.child;
    this.child = null;
    this.signature = "";
    this.resetNeeded = false;
    this.prompted = false;
    this.fail(new Error("Pi RPC 已关闭"));
    if (!child) return;
    child.stdin.end();
    child.kill("SIGTERM");
  }

  async send(request: ChatRequest, callbacks: ChatCallbacks, signal: AbortSignal): Promise<void> {
    if (this.callbacks) throw new Error("Pi 正在处理另一条消息");
    signal.throwIfAborted();
    this.callbacks = callbacks;
    if (!this.child) callbacks.onStatus("正在连接 Pi RPC…");
    const abort = () => {
      this.turnReject?.(new DOMException("已取消", "AbortError"));
      void this.shutdown();
    };
    signal.addEventListener("abort", abort, { once: true });
    try {
      await this.ensureConnected(request);
      if (this.resetNeeded) {
        await this.command("new_session", {}, 15_000);
        this.resetNeeded = false;
      }
      signal.throwIfAborted();
      const history = !this.prompted ? request.history.filter((m) => m.role === "user" || m.role === "assistant").slice(-20)
        .map((m) => `${m.role}: ${m.content}`).join("\n\n") : "";
      const message = [history, promptWithContext(request)].filter(Boolean).join("\n\n");
      const images = (request.attachments ?? []).filter((a) => a.mediaType.startsWith("image/") && a.url?.includes("base64,"))
        .map((a) => ({ type: "image", data: a.url!.split("base64,")[1], mimeType: a.mediaType }));
      callbacks.onStatus("正在通过 Pi 处理…");
      const completed = new Promise<void>((resolve, reject) => { this.turnResolve = resolve; this.turnReject = reject; });
      void completed.catch(() => {});
      const response = await this.command("prompt", { message, ...(images.length ? { images } : {}) }, 30_000);
      if (object(response.data).disposition !== "handled") await completed;
      this.prompted = true;
    } catch (error) {
      if (signal.aborted) throw new DOMException("已取消", "AbortError");
      throw error;
    } finally {
      signal.removeEventListener("abort", abort);
      this.callbacks = null;
      this.turnResolve = null;
      this.turnReject = null;
    }
  }

  private async ensureConnected(request: ChatRequest): Promise<void> {
    const generation = this.generation;
    while (this.connecting) await this.connecting;
    if (generation !== this.generation) throw new Error("Pi RPC 已关闭");
    const pending = this.connect(request);
    this.connecting = pending;
    try { await pending; }
    finally { if (this.connecting === pending) this.connecting = null; }
  }

  private async connect(request: ChatRequest): Promise<void> {
    const require = getRuntimeRequire();
    if (!require || !this.detection.path) throw new Error("Pi RPC 仅支持桌面版 Obsidian");
    const generation = this.generation;
    const env = await piProcessEnv(require, this.detection.env);
    if (generation !== this.generation) throw new Error("Pi RPC 已关闭");
    const signature = JSON.stringify([request.cwd, request.model, request.reasoningEffort, request.permissionMode, request.systemPrompt,
      env.HTTP_PROXY, env.HTTPS_PROXY, env.ALL_PROXY, env.NO_PROXY]);
    if (this.child && this.child.exitCode === null && this.signature === signature) return;
    if (this.child) await this.shutdown();
    const args = [...(this.detection.argsPrefix ?? []), "--mode", "rpc", "--no-session", "--no-skills", "--append-system-prompt", request.systemPrompt,
      ...(request.permissionMode === "plan" ? ["--tools", "read,grep,find,ls"] : []),
      ...(request.model ? ["--model", request.model] : []),
      ...(request.reasoningEffort ? ["--thinking", request.reasoningEffort] : [])];
    this.buffer = "";
    this.decoder = new TextDecoder();
    this.stderrTail = "";
    this.signature = signature;
    this.prompted = false;
    const child = (getCliProcesses(require) as { spawn: (path: string, args: string[], options: object) => Child }).spawn(this.detection.path, args, {
      cwd: request.cwd ?? undefined,
      env,
      windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    child.stdout.on("data", (chunk) => {
      if (this.child !== child) return;
      const parsed = splitJsonLines(this.buffer, this.decoder.decode(chunk, { stream: true }));
      this.buffer = parsed.rest;
      for (const line of parsed.lines) try { this.handle(JSON.parse(line) as Message); } catch { /* diagnostics are on stderr */ }
    });
    child.stderr.on("data", (chunk) => { this.stderrTail = `${this.stderrTail}${new TextDecoder().decode(chunk)}`.slice(-1_000); });
    child.on("error", (error: Error) => { if (this.child === child) { this.child = null; this.fail(error); } });
    child.on("exit", () => {
      if (this.child !== child) return;
      this.child = null;
      this.fail(new Error(`Pi RPC 已退出：${this.stderrTail.trim() || "进程结束"}`));
    });
  }

  private command(type: string, params: Message, timeoutMs: number): Promise<Message> {
    const child = this.child;
    if (!child?.stdin.writable) return Promise.reject(new Error("Pi RPC 尚未连接"));
    const id = `qiaomu-${this.nextId++}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Pi ${type} 请求超时`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify({ id, type, ...params })}\n`);
    });
  }

  private handle(message: Message): void {
    if (message.type === "response" && typeof message.id === "string") {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.success === false) pending.reject(new Error(String(message.error ?? "Pi 请求失败")));
      else pending.resolve(message);
      return;
    }
    if (!this.callbacks) return;
    if (message.type === "message_update") {
      const event = object(message.assistantMessageEvent);
      if (event.type === "text_delta" && typeof event.delta === "string") this.callbacks.onText(event.delta);
    } else if (message.type === "tool_execution_start" || message.type === "tool_execution_end") {
      if (message.type === "tool_execution_start" && ["write", "edit"].includes(String(message.toolName))) {
        const path = object(message.args).path;
        if (typeof path === "string") this.callbacks.onFileIntent?.([{ path }]);
      }
      this.callbacks.onActivity?.({ id: String(message.toolCallId ?? "pi-tool"), label: String(message.toolName ?? "工具调用"),
        status: message.type === "tool_execution_start" ? "running" : message.isError ? "failed" : "completed" });
    } else if (message.type === "agent_settled") {
      this.turnResolve?.();
    } else if (message.type === "message_end" && object(message.message).stopReason === "error") {
      this.turnReject?.(new Error(String(object(message.message).errorMessage ?? "Pi 模型请求失败")));
    } else if (message.type === "auto_retry_end" && message.success === false) {
      this.turnReject?.(new Error(String(message.finalError ?? "Pi 请求失败")));
    }
  }

  private fail(error: Error): void {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
    this.turnReject?.(error);
  }
}
