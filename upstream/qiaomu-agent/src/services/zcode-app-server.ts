import type { ChatCallbacks, ChatRequest, CliDetection, PermissionMode } from "../types";
import { promptWithContext } from "./cli-profiles";
import { JsonRpcProcess } from "./json-rpc-process";
import { getRuntimeRequire } from "./runtime-require";
import { zcodeError } from "./zcode-errors";

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue => value && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : {};
const valueAt = (value: unknown, key: string): ObjectValue => object(object(value)[key]);

/** ZCode's bundled 0.16.x stdio App Server is a private protocol, not ACP. */
export class ZcodeAppServer {
  canFallback = true;
  private process: JsonRpcProcess | null = null;
  private sessionId: string | null = null;
  private mode: PermissionMode | null = null;
  private callbacks: ChatCallbacks | null = null;
  private turnResolve: (() => void) | null = null;
  private turnReject: ((error: Error) => void) | null = null;
  private prompted = false;

  constructor(private readonly detection: CliDetection) {}

  async prepare(request: ChatRequest): Promise<void> { await this.connect(request); }

  resetSession(): void { this.sessionId = null; this.prompted = false; }

  async shutdown(): Promise<void> {
    this.resetSession();
    this.turnReject?.(new Error("ZCode 连接已关闭"));
    const process = this.process;
    this.process = null;
    await process?.stop();
  }

  async send(request: ChatRequest, callbacks: ChatCallbacks, signal: AbortSignal): Promise<void> {
    if (this.callbacks) throw new Error("ZCode 正在处理另一条消息");
    if (request.model?.trim()) throw new Error("请在 ZCode 中选择模型，插件使用它的默认模型");
    signal.throwIfAborted();
    this.canFallback = true;
    this.callbacks = callbacks;
    if (!this.process?.running) callbacks.onStatus("正在连接 ZCode App Server…");
    const abort = () => {
      if (this.sessionId) try { this.process?.notify("session/stop", { sessionId: this.sessionId }); } catch { /* already disconnected */ }
      this.turnReject?.(new DOMException("已取消", "AbortError"));
      void this.shutdown();
    };
    signal.addEventListener("abort", abort, { once: true });
    let turnTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      await this.connect(request);
      signal.throwIfAborted();
      const process = this.process!;
      if (!this.sessionId || this.mode !== request.permissionMode) {
        const result = object(await process.request("session/create", {
          workspace: { workspacePath: request.cwd, workspaceKey: request.cwd },
          mode: request.permissionMode === "full" ? "yolo" : request.permissionMode,
        }, 30_000));
        const id = valueAt(result, "session").sessionId;
        if (typeof id !== "string") throw new Error("ZCode App Server 未返回 sessionId");
        this.sessionId = id;
        this.mode = request.permissionMode;
        this.prompted = false;
        await process.request("session/subscribe", { sessionId: id, deliveryKind: "desktop-continuous", includeSnapshot: false, afterSeq: 0 }, 15_000);
      }
      signal.throwIfAborted();
      const history = !this.prompted ? request.history.filter((message) => message.role === "user" || message.role === "assistant").slice(-20)
        .map((message) => `${message.role}: ${message.content}`).join("\n\n") : "";
      const content = [!this.prompted && request.systemPrompt, history, promptWithContext(request)].filter(Boolean).join("\n\n");
      callbacks.onStatus("正在通过 ZCode 处理…");
      const completed = new Promise<void>((resolve, reject) => { this.turnResolve = resolve; this.turnReject = reject; });
      void completed.catch(() => {});
      turnTimer = setTimeout(() => this.turnReject?.(new Error("ZCode 本次回复超时")), 300_000);
      // Once sent, an ambiguous timeout must not replay the prompt through the CLI.
      this.canFallback = false;
      const accepted = object(await process.request("session/send", { sessionId: this.sessionId, content }, 15_000));
      if (accepted.accepted !== true) throw new Error("ZCode 未接受本次请求");
      await completed;
      this.prompted = true;
    } catch (error) {
      if (signal.aborted) throw new DOMException("已取消", "AbortError");
      if (error instanceof Error && error.name === "AbortError") throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(zcodeError(message, message));
    } finally {
      if (turnTimer) clearTimeout(turnTimer);
      signal.removeEventListener("abort", abort);
      this.turnResolve = null;
      this.turnReject = null;
      this.callbacks = null;
    }
  }

  private async connect(request: ChatRequest): Promise<void> {
    if (this.process?.running) return;
    const path = this.detection.nativePath ?? this.detection.path;
    if (!path) throw new Error("ZCode App Server 不可用");
    const require = getRuntimeRequire();
    if (!require) throw new Error("ZCode App Server 仅支持桌面版 Obsidian");
    const process = new JsonRpcProcess({
      executablePath: path,
      args: [...(this.detection.argsPrefix ?? []), "app-server"],
      cwd: request.cwd ?? undefined,
      env: { ...(require("process") as { env: Record<string, string | undefined> }).env, ...this.detection.env },
      includeJsonRpc: false,
      onNotification: (method, params) => { if (this.process === process) this.handleNotification(method, params); },
      onServerRequest: (id, method, params) => { if (this.process === process) this.handleServerRequest(id, method, params); },
      onClose: (reason) => { if (this.process !== process) return; this.process = null; this.resetSession(); this.turnReject?.(new Error(`ZCode 连接中断：${reason}`)); },
    });
    this.process = process;
    process.start();
  }

  private handleNotification(method: string, params: unknown): void {
    if (method !== "session/event" || object(params).sessionId !== this.sessionId) return;
    const event = object(params);
    const payload = valueAt(event, "payload");
    if (event.type === "model.streaming" && payload.kind === "text_delta" && typeof payload.delta === "string") {
      this.callbacks?.onText(payload.delta);
    } else if (event.type === "tool.updated") {
      const kind = String(payload.kind ?? "");
      if (kind === "scheduled" || kind === "started") {
        const input = valueAt(payload, "input");
        const path = input.file_path ?? input.path;
        if (typeof path === "string" && /write|edit/i.test(String(payload.toolName))) this.callbacks?.onFileIntent?.([{ path }]);
      }
      this.callbacks?.onActivity?.({
        id: String(payload.toolCallId ?? "zcode-tool"), label: String(payload.toolName ?? "工具调用"),
        status: kind === "error" ? "failed" : kind === "result" || kind === "batch" ? "completed" : "running",
      });
    } else if (event.type === "turn.completed" || event.type === "turn.terminal" && payload.status === "success") {
      this.turnResolve?.();
      this.turnResolve = null;
    } else if (event.type === "turn.failed" || event.type === "turn.terminal" && payload.status === "failed") {
      const message = String(valueAt(payload, "error").message ?? "ZCode 执行失败");
      this.turnReject?.(new Error(zcodeError(message, message)));
      this.turnReject = null;
    }
  }

  private handleServerRequest(id: number | string, method: string, params: unknown): void {
    const process = this.process;
    if (!process) return;
    if (method === "session/requestRuntimePreferences") {
      process.respond(id, { nativeSearchEnhancementsEnabled: false, memoryEnabled: false, askUserQuestionAutoResolutionEnabled: false });
      return;
    }
    if (method === "interaction/requestPermission") {
      const options = Array.isArray(object(params).options) ? object(params).options as ObjectValue[] : [];
      const deny = () => process.respond(id, { decision: "deny", reason: "cancelled by user" });
      if (this.mode === "plan" || !this.callbacks?.requestApproval) { deny(); return; }
      void this.callbacks.requestApproval({
        id: `zcode-${String(id)}`,
        title: String(object(params).toolName ?? "ZCode 请求执行操作"),
        detail: String(object(params).reason ?? ""),
        options: options.filter((option) => typeof option.optionId === "string").map((option) => ({
          id: String(option.optionId), label: String(option.name ?? option.kind ?? option.optionId),
          kind: (/^allow/.test(String(option.kind ?? option.optionId))
            ? /always|project/.test(String(option.kind ?? option.optionId)) ? "allow_always" : "allow_once"
            : "reject_once") as "allow_once" | "allow_always" | "reject_once",
        })),
      }).then((chosen) => {
        const selected = options.find((option) => option.optionId === chosen);
        const response = object(selected?.response);
        process.respond(id, response.decision === "allow" || response.decision === "deny" ? response :
          selected && /^allow/.test(String(selected.optionId)) ? { decision: "allow" } : { decision: "deny" });
      }, deny);
      return;
    }
    process.reject(id, -32601, `Unsupported ZCode client method: ${method}`);
  }
}
