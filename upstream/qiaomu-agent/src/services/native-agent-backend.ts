import type {
  ApprovalOptionKind,
  ApprovalRequest,
  ChatActivity,
  ChatActivityStatus,
  ChatBackend,
  ChatCallbacks,
  ChatPlan,
  ChatRequest,
  CliDetection,
  ContextUsage,
  ExploreAction,
  GeneratedAttachment,
  PermissionMode,
  ModelChoice,
} from "../types";
import { promptWithContext } from "./cli-profiles";
import { acpContextUsage, codexContextUsage } from "./context-usage";
import { JsonRpcProcess } from "./json-rpc-process";
import { getRuntimeRequire } from "./runtime-require";
import { acpElicitationQuestions, acpElicitationResponse, codexQuestionRequest, codexQuestionResponse } from "./user-questions";

const ACP_AGENTS = new Set(["gemini", "opencode", "qwen", "kimi", "cursor", "cline", "auggie", "hermes", "openclaw"]);

export function nativeTransportFor(agentId: string, nativePath?: string): "app-server" | "acp" | null {
  if (agentId === "codex") return "app-server";
  if ((agentId === "claude" || agentId === "grok") && nativePath) return "acp";
  return ACP_AGENTS.has(agentId) ? "acp" : null;
}

export function nativeTransportLabel(agentId: string, nativePath?: string): string | null {
  const transport = nativeTransportFor(agentId, nativePath);
  return transport === "app-server" ? "App Server" : transport === "acp" ? "ACP" : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringAt(value: unknown, ...keys: string[]): string | null {
  let current: unknown = value;
  for (const key of keys) current = record(current)?.[key];
  return typeof current === "string" ? current : null;
}

function arrayAt(value: unknown, ...keys: string[]): unknown[] {
  let current: unknown = value;
  for (const key of keys) current = record(current)?.[key];
  return Array.isArray(current) ? current : [];
}

function activityStatus(value: unknown): ChatActivityStatus {
  switch (value) {
    case "in_progress":
    case "inProgress": return "running";
    case "completed": return "completed";
    case "failed": return "failed";
    case "cancelled":
    case "canceled": return "cancelled";
    default: return "pending";
  }
}

export function codexGeneratedAttachment(item: Record<string, unknown>): GeneratedAttachment | null {
  const id = typeof item.id === "string" ? item.id : crypto.randomUUID();
  const result = typeof item.result === "string" ? item.result.replace(/^data:[^;]+;base64,/, "") : undefined;
  const savedPath = typeof item.savedPath === "string" ? item.savedPath : typeof item.path === "string" ? item.path : undefined;
  if (!result && !savedPath) return null;
  let cleanPath = savedPath?.replace(/^file:\/\//, "");
  if (cleanPath) try { cleanPath = decodeURIComponent(cleanPath); } catch { /* keep the server path verbatim */ }
  const name = cleanPath?.split(/[\\/]/).at(-1) || `${id}.png`;
  const extension = name.split(".").at(-1)?.toLowerCase();
  const mediaType = extension === "jpg" || extension === "jpeg" ? "image/jpeg" : extension === "webp" ? "image/webp" : extension === "gif" ? "image/gif" : "image/png";
  return { id, name, mediaType, size: result ? Math.floor(result.length * 0.75) : 0, base64: result, localPath: savedPath };
}

function effectivePrompt(request: ChatRequest, includeHistory: boolean, includeSystemPrompt = includeHistory): string {
  const prompt = promptWithContext(request);
  const history = request.history.slice(-20).filter((m) => m.role !== "status").map((m) => `${m.role}: ${m.content}`).join("\n\n");
  return includeHistory ? `${includeSystemPrompt ? `${request.systemPrompt}\n\n` : ""}${history ? `<prior_conversation>\n${history}\n</prior_conversation>\n\n` : ""}${prompt}` : prompt;
}

export function acpLaunch(agentId: string, permissionMode: PermissionMode): string[] {
  if (agentId === "grok") return ["--no-auto-update", "agent", "stdio"];
  if (agentId === "claude") return [];
  if (["kimi", "opencode", "cursor", "hermes", "openclaw"].includes(agentId)) return ["acp"];
  if (["cline", "auggie"].includes(agentId)) return ["--acp"];
  if (agentId === "qwen") return ["--acp", "--approval-mode", permissionMode !== "plan" ? "auto-edit" : "plan"];
  return ["--acp", "--approval-mode", permissionMode !== "plan" ? "auto_edit" : "plan"];
}

export function acpMcpServers(config: Record<string, unknown> | undefined): unknown[] {
  const servers = record(config?.mcpServers);
  if (!servers) return [];
  const result: unknown[] = [];
  for (const [name, raw] of Object.entries(servers)) {
    const server = record(raw);
    if (!server) continue;
    if (typeof server.command === "string") {
      const environment = record(server.env);
      result.push({
        name,
        command: server.command,
        args: Array.isArray(server.args) ? server.args.filter((item): item is string => typeof item === "string") : [],
        env: environment ? Object.entries(environment).map(([key, value]) => ({ name: key, value: String(value) })) : [],
      });
    } else if (typeof server.url === "string") {
      result.push({ type: "http", name, url: server.url, headers: [] });
    }
  }
  return result;
}

export class NativeAgentBackend implements ChatBackend {
  readonly id: string;
  readonly label: string;
  private process: JsonRpcProcess | null = null;
  private sessionId: string | null = null;
  private mcpSignature = "";
  private activeCallbacks: ChatCallbacks | null = null;
  private lastUsage: ContextUsage | null = null;
  private activePermissionMode: PermissionMode = "plan";
  private connectedMode: PermissionMode | null = null;
  private ready = false;
  private connecting: Promise<void> | null = null;
  private sessionCreating: Promise<void> | null = null;
  private sessionGeneration = 0;
  private legacyModelId: string | null = null;
  private activeTurnId: string | null = null;
  private configOptions: Record<string, unknown>[] = [];
  private acpModes: string[] = [];
  private acpCurrentMode: string | null = null;
  private legacyModels: ModelChoice[] = [];
  private imageInput = false;
  private prompted = false;
  private mediaTasks: Promise<void>[] = [];
  private emittedMedia = new Set<string>();

  isBusy(): boolean { return this.activeCallbacks !== null; }

  /** Only starts the transport: no prompt, empty thread, or model request. */
  async prepare(request: ChatRequest): Promise<void> {
    await this.ensureConnected(request);
  }

  async listModels(request: ChatRequest): Promise<ModelChoice[]> {
    if (this.activeCallbacks) throw new Error("请等当前回复结束后切换模型");
    await this.ensureConnected(request);
    if (this.detection.id === "codex") {
      const models: ModelChoice[] = [];
      let cursor: string | null = null;
      do {
        const result = await this.process!.request("model/list", { limit: 100, cursor }, 15_000);
        for (const raw of arrayAt(result, "data")) {
          const model = record(raw);
          if (!model || model.hidden || typeof model.model !== "string") continue;
          models.push({ id: model.model, name: String(model.displayName || model.model), isDefault: model.isDefault === true,
            efforts: arrayAt(model, "supportedReasoningEfforts").map((e) => stringAt(e, "reasoningEffort")).filter((e): e is string => !!e) });
        }
        cursor = stringAt(result, "nextCursor");
      } while (cursor);
      return models;
    }
    await this.ensureAcpSession(request);
    await this.ensureClaudeMode(request.permissionMode);
    return this.acpModels();
  }

  private acpModels(): ModelChoice[] {
    const model = this.configOptions.find((o) => o.category === "model" || o.id === "model");
    const effort = this.configOptions.find((o) => o.category === "thought_level");
    const choices = (option: Record<string, unknown> | undefined): Record<string, unknown>[] => arrayAt(option, "options").flatMap((o) => {
      const value = record(o); return value && Array.isArray(value.options) ? value.options.map(record).filter((v): v is Record<string, unknown> => !!v) : value ? [value] : [];
    });
    const efforts = choices(effort).map((o) => String(o.value));
    return model ? choices(model).map((o) => ({ id: String(o.value), name: String(o.name || o.value), efforts, isDefault: o.value === model.currentValue })) : this.legacyModels;
  }

  private async ensureAcpSession(request: ChatRequest): Promise<void> {
    while (this.sessionCreating) await this.sessionCreating;
    const creating = this.createAcpSession(request);
    this.sessionCreating = creating;
    try { await creating; }
    finally { if (this.sessionCreating === creating) this.sessionCreating = null; }
  }

  private async createAcpSession(request: ChatRequest): Promise<void> {
    const servers = acpMcpServers(request.mcpConfig);
    const signature = JSON.stringify([request.cwd, servers]);
    if (this.sessionId && this.mcpSignature !== signature) this.resetSession();
    if (this.sessionId) return;
    const generation = this.sessionGeneration;
    const process = this.process;
    if (!process) throw new Error("Agent 连接已关闭");
    const result = await process.request("session/new", { cwd: request.cwd, mcpServers: servers }, 30_000);
    if (this.process !== process || generation !== this.sessionGeneration) throw new Error("Agent 会话已重置");
    this.sessionId = stringAt(result, "sessionId");
    this.legacyModelId = stringAt(result, "models", "currentModelId");
    if (!this.sessionId) throw new Error("ACP Agent 未返回 sessionId");
    this.mcpSignature = signature;
    this.configOptions = arrayAt(result, "configOptions").map(record).filter((o): o is Record<string, unknown> => !!o);
    this.legacyModels = arrayAt(result, "models", "availableModels").map((m) => ({ id: stringAt(m, "modelId") || "", name: stringAt(m, "name") || "", efforts: [] })).filter((m) => !!m.id);
    this.acpModes = arrayAt(result, "modes", "availableModes").map((mode) => stringAt(mode, "id")).filter((id): id is string => !!id);
    this.acpCurrentMode = stringAt(result, "modes", "currentModeId");
    this.prompted = false;
  }

  private async ensureClaudeMode(permissionMode: PermissionMode): Promise<void> {
    if (this.detection.id !== "claude" || !this.process || !this.sessionId) return;
    const desired = permissionMode === "plan" ? "plan" : permissionMode === "edit" ? "acceptEdits" : "bypassPermissions";
    if (!this.acpModes.includes(desired)) throw new Error(`Claude ACP 未提供 ${desired} 权限模式`);
    if (this.acpCurrentMode === desired) return;
    await this.process.request("session/set_mode", { sessionId: this.sessionId, modeId: desired }, 15_000);
    this.acpCurrentMode = desired;
  }

  constructor(private readonly detection: CliDetection) {
    if (!detection.path || !nativeTransportFor(detection.id, detection.nativePath)) throw new Error("该 Agent 没有可用的原生协议");
    this.id = `cli:${detection.id}`;
    this.label = `${detection.label} · ${nativeTransportLabel(detection.id, detection.nativePath)}`;
  }

  async send(request: ChatRequest, callbacks: ChatCallbacks, signal: AbortSignal): Promise<void> {
    if (this.activeCallbacks) throw new Error(`${this.detection.label} 正在处理另一条消息`);
    this.activeCallbacks = callbacks;
    this.reasoning.clear();
    this.mediaTasks = [];
    this.emittedMedia.clear();
    this.activePermissionMode = request.permissionMode;
    let cancelTimer: ReturnType<typeof setTimeout> | undefined;
    const abort = (): void => {
      this.cancel();
      cancelTimer = setTimeout(() => { if (this.activeCallbacks === callbacks) void this.shutdown(); }, 5_000);
    };
    signal.addEventListener("abort", abort, { once: true });
    try {
      signal.throwIfAborted();
      if (!this.ready) callbacks.onStatus(`正在连接 ${this.detection.label}…`);
      await this.ensureConnected(request);
      signal.throwIfAborted();
      if (!this.process) throw new Error("原生 Agent 连接未建立");
      // An agent may report usage after its prompt response; carry it into this reply until a new report arrives.
      if (this.lastUsage) callbacks.onUsage?.(this.lastUsage);
      if (this.detection.id === "codex") await this.sendCodex(request, signal);
      else await this.sendAcp(request);
      await Promise.all(this.mediaTasks);
    } finally {
      signal.removeEventListener("abort", abort);
      if (cancelTimer) clearTimeout(cancelTimer);
      this.activeCallbacks = null;
    }
  }

  private reportUsage(usage: ContextUsage | null): void {
    if (!usage) return;
    this.lastUsage = usage;
    this.activeCallbacks?.onUsage?.(usage);
  }

  resetSession(): void {
    this.sessionGeneration++;
    this.legacyModelId = null;
    this.sessionId = null;
    this.acpCurrentMode = null;
    this.lastUsage = null;
    this.prompted = false;
  }

  async shutdown(): Promise<void> {
    this.resetSession();
    this.activeTurnId = null;
    this.turnReject?.(new Error("Agent 连接已关闭"));
    this.turnResolve = null; this.turnReject = null;
    this.ready = false;
    this.connectedMode = null;
    const process = this.process;
    this.process = null;
    await process?.stop();
  }

  private async ensureConnected(request: ChatRequest): Promise<void> {
    // Model discovery and the first send can arrive while initialization is pending.
    // All callers must use the same process, including a background preparation.
    const generation = this.sessionGeneration;
    while (this.connecting) await this.connecting;
    if (generation !== this.sessionGeneration) throw new Error("Agent 会话已重置");
    const connection = this.connect(request);
    this.connecting = connection;
    try { await connection; }
    finally { if (this.connecting === connection) this.connecting = null; }
  }

  private async connect(request: ChatRequest): Promise<void> {
    const path = this.detection.nativePath ?? this.detection.path;
    if (!path) throw new Error(`${this.detection.label} 当前不可用`);
    const transport = nativeTransportFor(this.detection.id, this.detection.nativePath);
    const modeChanged = transport === "acp" && this.connectedMode !== null
      && JSON.stringify(acpLaunch(this.detection.id, this.connectedMode)) !== JSON.stringify(acpLaunch(this.detection.id, request.permissionMode));
    if (modeChanged) await this.shutdown();
    if (this.process?.running && this.ready) return;
    const args = transport === "app-server"
      ? [...CODEX_FEATURES, "app-server", "--listen", "stdio://"]
      : [...(this.detection.nativeArgsPrefix ?? []), ...acpLaunch(this.detection.id, request.permissionMode)];
    const process = new JsonRpcProcess({
      executablePath: path,
      args,
      ...(request.cwd ? { cwd: request.cwd } : {}),
      env: { ...(getRuntimeRequire()?.("process") as { env?: Record<string, string | undefined> } | undefined)?.env, ...this.detection.env },
      includeJsonRpc: transport === "acp",
      onNotification: (method, params) => { if (this.process === process) this.handleNotification(method, params); },
      onServerRequest: (id, method, params) => { if (this.process === process) this.handleServerRequest(id, method, params); },
      onLog: (message) => console.debug(`Qiaomu Agent ${this.detection.id}: ${message}`),
      onClose: (reason) => {
        if (this.process !== process) return;
        this.process = null;
        this.resetSession();
        this.ready = false;
        this.turnReject?.(new Error(reason));
        this.turnResolve = null; this.turnReject = null;
        this.sessionId = null;
        this.lastUsage = null;
        this.activeCallbacks?.onStatus(`${this.detection.label} · 连接中断`);
        console.warn(`Qiaomu Agent ${this.detection.id} native transport closed: ${reason}`);
      },
    });
    this.process = process;
    try {
      process.start();
      if (transport === "app-server") {
        await process.request("initialize", {
          clientInfo: { name: "qiaomu_agent_obsidian", title: "Qiaomu Agent for Obsidian", version: "0.1.0" },
        }, 15_000);
        process.notify("initialized", {});
      } else {
        const initialized = await process.request("initialize", {
          protocolVersion: 1,
          // Reads and writes go through Obsidian so the turn can be reviewed and rolled back.
          // Form elicitation lets Claude's AskUserQuestion reach the question card instead of a permission prompt.
          clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, elicitation: { form: {} } },
          clientInfo: { name: "qiaomu-agent", title: "Qiaomu Agent for Obsidian", version: "0.1.0" },
        }, 15_000);
        const protocolVersion = record(initialized)?.protocolVersion;
        this.imageInput = record(record(record(initialized)?.agentCapabilities)?.promptCapabilities)?.image === true;
        if (protocolVersion !== 1) throw new Error(`不支持 ACP 协议版本 ${String(protocolVersion)}`);
        if (this.detection.id === "grok") {
          const authMethods = arrayAt(initialized, "authMethods").map((method) => stringAt(method, "id"));
          const methodId = authMethods.includes("cached_token") ? "cached_token" : authMethods.includes("xai.api_key") ? "xai.api_key" : null;
          if (!methodId) throw new Error("Grok 尚未登录，请先运行 grok login");
          await process.request("authenticate", { methodId, _meta: { headless: true } }, 15_000);
        }
      }
      if (this.process !== process || !process.running) throw new Error("Agent 连接已关闭");
      this.ready = true;
      this.connectedMode = request.permissionMode;
    } catch (error) {
      if (this.process === process) this.process = null;
      await process.stop();
      throw error;
    }
  }

  private async sendCodex(request: ChatRequest, signal: AbortSignal): Promise<void> {
    if (!this.process) return;
    if (!this.sessionId) {
      this.activeCallbacks?.onStatus("正在准备 Codex 会话…");
      const result = await this.process.request("thread/start", {
        cwd: request.cwd,
        ...(request.model ? { model: request.model } : {}),
        approvalPolicy: codexApprovalPolicy(request.permissionMode),
        sandbox: request.permissionMode === "full" ? "danger-full-access" : request.permissionMode === "edit" ? "workspace-write" : "read-only",
        developerInstructions: request.systemPrompt,
        serviceName: "qiaomu_agent_obsidian",
      }, 30_000);
      this.sessionId = stringAt(result, "thread", "id");
      if (!this.sessionId) throw new Error("Codex App Server 未返回 threadId");
    }
    const params = {
      threadId: this.sessionId,
      input: [{ type: "text", text: effectivePrompt(request, !this.prompted, false), text_elements: [] },
        ...(request.attachments ?? []).filter((a) => a.mediaType.startsWith("image/")).map((a) => ({ type: "image", url: a.url }))],
      ...(request.model ? { model: request.model } : {}),
      ...(request.reasoningEffort ? { effort: request.reasoningEffort } : {}),
      cwd: request.cwd,
      approvalPolicy: codexApprovalPolicy(request.permissionMode),
      sandboxPolicy: request.permissionMode === "full"
        ? { type: "dangerFullAccess" }
        : request.permissionMode === "edit"
          ? { type: "workspaceWrite", writableRoots: request.cwd ? [request.cwd] : [], networkAccess: false }
          : { type: "readOnly" },
    };
    signal.throwIfAborted();
    this.activeCallbacks?.onStatus("正在思考…");
    const completion = this.waitForTurn();
    try {
      const result = await this.process.request("turn/start", params, 30_000);
      this.activeTurnId = stringAt(result, "turn", "id");
      if (signal.aborted) this.cancel();
      await completion;
      this.prompted = true;
    } finally { this.turnResolve = null; this.turnReject = null; }
  }

  private async sendAcp(request: ChatRequest): Promise<void> {
    if (!this.process) return;
    await this.ensureAcpSession(request);
    await this.ensureClaudeMode(request.permissionMode);
    const firstPrompt = !this.prompted;
    for (const [category, value] of [["model", request.model], ["thought_level", request.reasoningEffort]]) {
      if (!value) continue;
      const config = this.configOptions.find((o) => o.category === category || o.id === category);
      if (config) {
        if (config.currentValue === value) continue;
        const updated = await this.process.request("session/set_config_option", { sessionId: this.sessionId, configId: config.id, value }, 15_000);
        this.configOptions = arrayAt(updated, "configOptions").map(record).filter((o): o is Record<string, unknown> => !!o);
      } else if (category === "model" && this.legacyModels.length) {
        if (this.legacyModelId === value) continue;
        await this.process.request("session/set_model", { sessionId: this.sessionId, modelId: value }, 15_000);
        this.legacyModelId = value;
      } else throw new Error("此 ACP 连接未提供对应的模型或推理设置");
    }
    const images = (request.attachments ?? []).filter((a) => a.mediaType.startsWith("image/"));
    if (images.length && !this.imageInput) throw new Error("当前 ACP 连接未声明图片能力，请移除图片或切换连接");
    this.activeCallbacks?.onStatus("正在思考…");
    await this.process.request("session/prompt", {
      sessionId: this.sessionId,
      prompt: [{ type: "text", text: effectivePrompt(request, firstPrompt) }, ...images.map((a) => ({ type: "image", mimeType: a.mediaType, data: a.url?.split(",")[1] }))],
    }, 60 * 60 * 1_000);
    this.prompted = true;
  }

  /** Reasoning summaries streamed this turn, keyed by item and part; only their headings are shown. */
  private readonly reasoning = new Map<string, string>();
  private turnResolve: (() => void) | null = null;
  private turnReject: ((error: Error) => void) | null = null;

  private waitForTurn(): Promise<void> {
    const promise = new Promise<void>((resolve, reject) => { this.turnResolve = resolve; this.turnReject = reject; });
    void promise.catch(() => {});
    return promise;
  }

  private cancel(): void {
    if (!this.process || !this.sessionId) return;
    if (this.detection.id === "codex") {
      if (!this.activeTurnId) return;
      void this.process.request("turn/interrupt", { threadId: this.sessionId, turnId: this.activeTurnId }, 5_000).catch(() => {});
    } else {
      this.process.notify("session/cancel", { sessionId: this.sessionId });
    }
  }

  private handleNotification(method: string, params: unknown): void {
    if (this.detection.id === "codex") {
      if (method === "item/agentMessage/delta" || method === "item/plan/delta") {
        const delta = stringAt(params, "delta");
        if (delta) { this.reasoning.clear(); this.activeCallbacks?.onStatus(""); this.activeCallbacks?.onText(delta); }
      } else if (method === "item/reasoning/summaryTextDelta") {
        const key = `${stringAt(params, "itemId")}:${String(record(params)?.summaryIndex ?? 0)}`;
        const summary = (this.reasoning.get(key) ?? "") + (stringAt(params, "delta") ?? "");
        this.reasoning.set(key, summary);
        const heading = reasoningHeading(summary);
        if (heading) this.activeCallbacks?.onStatus(heading);
      } else if (method === "turn/plan/updated") {
        const plan = codexPlan(params);
        if (plan) this.activeCallbacks?.onPlan?.(plan);
      } else if (method === "item/started" || method === "item/completed") {
        const item = record(record(params)?.item);
        if (item?.type === "agentMessage" && method === "item/completed") this.activeCallbacks?.onTextEnd?.();
        else if (item) this.emitCodexActivity(item, method === "item/completed");
      } else if (method === "thread/tokenUsage/updated") {
        this.reportUsage(codexContextUsage(params));
      } else if (method === "turn/completed") {
        this.activeTurnId = null;
        const turn = record(record(params)?.turn);
        if (turn?.status === "failed") this.turnReject?.(new Error(stringAt(turn, "error", "message") || "Codex 执行失败"));
        else this.turnResolve?.();
        this.turnResolve = null;
      }
      return;
    }
    if (method !== "session/update") return;
    const update = record(record(params)?.update);
    if (!update) return;
    const kind = update.sessionUpdate;
    if (kind === "config_option_update") {
      this.configOptions = arrayAt(update, "configOptions").map(record).filter((o): o is Record<string, unknown> => !!o);
      return;
    }
    if (kind === "usage_update") {
      this.reportUsage(acpContextUsage(update));
      return;
    }
    if (kind === "plan") {
      const steps = arrayAt(update, "entries").map(record).flatMap((entry) => {
        const step = typeof entry?.content === "string" ? entry.content.trim() : "";
        const status: PlanStatus = entry?.status === "completed" ? "completed" : entry?.status === "in_progress" ? "inProgress" : "pending";
        return step ? [{ step, status }] : [];
      });
      if (steps.length) this.activeCallbacks?.onPlan?.({ steps });
      return;
    }
    if (kind === "agent_message_chunk") {
      const text = stringAt(update, "content", "text");
      if (text) this.activeCallbacks?.onText(text);
      return;
    }
    if (kind === "tool_call" || kind === "tool_call_update") {
      const id = typeof update.toolCallId === "string" ? update.toolCallId : `tool-${Date.now()}`;
      const intents = acpFileIntents(update);
      if (intents.length) this.activeCallbacks?.onFileIntent?.(intents);
      const label = typeof update.title === "string" ? update.title : typeof update.name === "string" ? update.name : "工具调用";
      // Reads and searches fold into one "已探索" row; titles already say what other tools did, so they stay as given.
      const explore = update.kind === "read" ? "read" : update.kind === "search" ? "search" : null;
      this.activeCallbacks?.onActivity?.({
        id,
        label,
        status: activityStatus(update.status),
        detail: toolDetail(update.content),
        ...(explore && label !== "工具调用" ? { kind: "explore" as const, actions: [{ type: explore, target: label } satisfies ExploreAction] } : {}),
      });
    }
  }

  private emitCodexActivity(item: Record<string, unknown>, completed: boolean): void {
    const type = typeof item.type === "string" ? item.type : "tool";
    if (type === "userMessage" || type === "agentMessage" || type === "plan" || type === "thinking" || type === "reasoning") return;
    const id = typeof item.id === "string" ? item.id : `${type}-${Date.now()}`;
    if (type === "fileChange" && !completed) {
      const intents = codexFileIntents(item);
      if (intents.length) this.activeCallbacks?.onFileIntent?.(intents);
    }
    // Between steps Codex is thinking again; while a step runs, its own row shows the progress.
    this.activeCallbacks?.onStatus(completed ? "正在思考…" : "");
    this.activeCallbacks?.onActivity?.({
      id,
      ...codexActivity(item, type),
      status: completed ? activityStatus(item.status ?? "completed") : "running",
    });
    if (completed && (type === "imageGeneration" || type === "imageView")) this.emitCodexImage(item, type);
  }

  private emitCodexImage(item: Record<string, unknown>, type: string): void {
    const callbacks = this.activeCallbacks;
    if (!callbacks?.onAttachment) return;
    const attachment = codexGeneratedAttachment(item);
    if (!attachment) return;
    let cleanPath = attachment.localPath?.replace(/^file:\/\//, "");
    if (cleanPath) try { cleanPath = decodeURIComponent(cleanPath); } catch { /* keep the server path verbatim */ }
    const key = cleanPath || `${type}:${attachment.id}`;
    if (this.emittedMedia.has(key)) return;
    this.emittedMedia.add(key);
    const task = Promise.resolve(callbacks.onAttachment(attachment));
    void task.catch(() => {});
    this.mediaTasks.push(task);
  }

  private handleServerRequest(id: number | string, method: string, params: unknown): void {
    const process = this.process;
    if (!process) return;
    const reply = (result: unknown) => { if (this.process === process) process.respond(id, result); };
    if (method === "session/request_permission") {
      const options = arrayAt(params, "options").map(record).filter((item): item is Record<string, unknown> => Boolean(item));
      const pick = (kinds: string[]) => options.find((option) => kinds.includes(String(option.kind)));
      const select = (option: Record<string, unknown> | undefined) => reply(option && typeof option.optionId === "string"
        ? { outcome: { outcome: "selected", optionId: option.optionId } }
        : { outcome: { outcome: "cancelled" } });
      // Read-only turns never gain write access, whatever the agent asks.
      if (this.activePermissionMode === "plan") { select(pick(["reject_once", "reject_always"])); return; }
      const ask = this.activeCallbacks?.requestApproval;
      if (!ask) { select(pick(["allow_once", "allow_always"])); return; }
      const toolCall = record(record(params)?.toolCall);
      void ask({
        id: `acp-${String(id)}`,
        title: stringAt(toolCall, "title") || "Agent 请求执行操作",
        detail: toolDetail(toolCall?.content) ?? (arrayAt(toolCall, "locations").map((l) => stringAt(l, "path")).filter(Boolean).join("\n") || undefined),
        options: options.filter((o) => typeof o.optionId === "string").map((o) => ({ id: String(o.optionId), label: OPTION_LABELS[String(o.kind)] ?? String(o.name || o.kind), kind: String(o.kind) as ApprovalOptionKind })),
      }).then((chosen) => select(chosen ? options.find((o) => o.optionId === chosen) : undefined), () => select(undefined));
      return;
    }
    if (method === "fs/read_text_file" || method === "fs/write_text_file") {
      void this.handleFs(method, params).then(reply, (error: unknown) => {
        if (this.process === process) process.reject(id, -32602, error instanceof Error ? error.message : String(error));
      });
      return;
    }
    if (method === "item/tool/requestUserInput" || method === "elicitation/create") {
      const ask = this.activeCallbacks?.requestUserInput;
      const questionId = `question-${String(id)}`;
      if (method === "item/tool/requestUserInput") {
        const request = codexQuestionRequest(params, questionId);
        if (!ask || !request) { reply(codexQuestionResponse(null)); return; }
        void ask(request).then((answers) => reply(codexQuestionResponse(answers)), () => reply(codexQuestionResponse(null)));
        return;
      }
      const parsed = acpElicitationQuestions(params, questionId);
      if (!ask || !parsed) { reply({ action: "decline" }); return; }
      void ask(parsed.request).then((answers) => reply(acpElicitationResponse(parsed, answers)), () => reply({ action: "cancel" }));
      return;
    }
    const codexApproval = CODEX_APPROVALS[method];
    if (codexApproval) {
      const ask = this.activeCallbacks?.requestApproval;
      const decide = (choice: "accept" | "session" | "decline" | "cancel") => reply({ decision: codexApproval.decision[choice] });
      if (!ask) { decide("decline"); return; }
      const request = codexApprovalRequest(method, params, String(id));
      void ask(request).then((chosen) => decide(chosen === "allow_once" ? "accept" : chosen === "allow_always" ? "session" : chosen === "reject_once" ? "decline" : "cancel"), () => decide("cancel"));
      return;
    }
    process.reject(id, -32601, `Unsupported client method: ${method}`);
  }

  private async handleFs(method: string, params: unknown): Promise<unknown> {
    const host = this.activeCallbacks?.host;
    const path = stringAt(params, "path");
    if (!host || !path) throw new Error("当前没有可用的文件访问");
    if (method === "fs/read_text_file") {
      const content = await host.readText(path);
      const line = record(params)?.line;
      const limit = record(params)?.limit;
      if (typeof line !== "number" && typeof limit !== "number") return { content };
      const lines = content.split("\n");
      const start = typeof line === "number" ? Math.max(0, line - 1) : 0;
      return { content: lines.slice(start, typeof limit === "number" ? start + limit : undefined).join("\n") };
    }
    if (this.activePermissionMode === "plan") throw new Error("当前为只读模式，不能写入文件");
    const content = stringAt(params, "content");
    if (content === null) throw new Error("缺少写入内容");
    await host.writeText(path, content);
    return null;
  }
}

/** request_user_input is otherwise limited to Codex's Plan mode; the sidebar answers it in every mode. */
export const CODEX_FEATURES = ["-c", "features.default_mode_request_user_input=true"];

const OPTION_LABELS: Record<string, string> = { allow_once: "允许一次", allow_always: "本次会话都允许", reject_once: "拒绝", reject_always: "始终拒绝" };

const CODEX_APPROVALS: Record<string, { decision: Record<"accept" | "session" | "decline" | "cancel", string> }> = {
  "item/commandExecution/requestApproval": { decision: { accept: "accept", session: "acceptForSession", decline: "decline", cancel: "cancel" } },
  "item/fileChange/requestApproval": { decision: { accept: "accept", session: "acceptForSession", decline: "decline", cancel: "cancel" } },
  execCommandApproval: { decision: { accept: "approved", session: "approved_for_session", decline: "denied", cancel: "abort" } },
  applyPatchApproval: { decision: { accept: "approved", session: "approved_for_session", decline: "denied", cancel: "abort" } },
};

/** Read-only turns cannot write at all; writable turns let Codex ask before escalating. */
export function codexApprovalPolicy(mode: PermissionMode): "never" | "on-request" {
  return mode === "edit" ? "on-request" : "never";
}

const APPROVAL_OPTIONS: ApprovalRequest["options"] = [
  { id: "allow_once", label: "允许一次", kind: "allow_once" },
  { id: "allow_always", label: "本次会话都允许", kind: "allow_always" },
  { id: "reject_once", label: "拒绝", kind: "reject_once" },
];

export function codexApprovalRequest(method: string, params: unknown, id: string): ApprovalRequest {
  const reason = stringAt(params, "reason");
  const command = stringAt(params, "command") ?? (Array.isArray(record(params)?.command) ? (record(params)!.command as unknown[]).join(" ") : null);
  const isCommand = method.includes("ommand") || method === "execCommandApproval";
  const root = stringAt(params, "grantRoot");
  return {
    id: `codex-${id}`,
    title: isCommand ? "Codex 请求执行命令" : "Codex 请求写入文件",
    detail: [command, root ? `申请写入：${root}` : null, reason].filter(Boolean).join("\n") || undefined,
    options: APPROVAL_OPTIONS,
  };
}

/** ACP diff content carries exact before-text; edit locations let us snapshot before the write. */
export function acpFileIntents(update: Record<string, unknown>): Array<{ path: string; before?: string | null; read?: boolean }> {
  const intents: Array<{ path: string; before?: string | null; read?: boolean }> = [];
  for (const raw of arrayAt(update, "content")) {
    const item = record(raw);
    if (item?.type !== "diff" || typeof item.path !== "string") continue;
    intents.push({ path: item.path, before: typeof item.oldText === "string" ? item.oldText : null });
  }
  const kind = update.kind;
  if (kind === "edit" || kind === "delete" || kind === "move" || kind === "read") {
    // Agents name the target in locations or in the tool's raw input (OpenCode: rawInput.path before writing).
    const input = record(update.rawInput);
    const paths = [
      ...arrayAt(update, "locations").map((location) => stringAt(location, "path")),
      ...["path", "filePath", "file_path", "filepath", "target", "destination", "newPath", "new_path"].map((key) => typeof input?.[key] === "string" ? input[key] as string : null),
    ];
    // Reads are remembered as candidate before-states: agents usually read a file before editing it.
    for (const path of paths) if (path && !intents.some((intent) => intent.path === path)) intents.push(kind === "read" ? { path, read: true } : { path });
  }
  return intents;
}

/** Codex announces a patch (item/started) before applying it. */
export function codexFileIntents(item: Record<string, unknown>): Array<{ path: string; before?: string | null; patch?: string }> {
  const intents: Array<{ path: string; before?: string | null; patch?: string }> = [];
  for (const raw of arrayAt(item, "changes")) {
    const change = record(raw);
    const path = stringAt(change, "path");
    if (!change || !path) continue;
    const kind = stringAt(change, "kind", "type");
    const diff = typeof change.diff === "string" ? change.diff : undefined;
    if (kind === "add") intents.push({ path, before: null });
    // The delete payload format is unverified, so the file is read from disk before Codex removes it.
    else if (kind === "delete") intents.push({ path });
    else {
      intents.push({ path, ...(diff ? { patch: diff } : {}) });
      const moved = stringAt(change, "kind", "move_path");
      if (moved) intents.push({ path: moved, before: null });
    }
  }
  return intents;
}

function toolDetail(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  for (const entry of value) {
    const item = record(entry);
    const text = stringAt(item, "content", "text");
    if (text) return text.slice(0, 300);
    if (typeof item?.path === "string") return item.path;
  }
  return undefined;
}

type PlanStatus = ChatPlan["steps"][number]["status"];

const CODEX_LABELS: Record<string, string> = {
  commandExecution: "执行命令",
  fileChange: "修改文件",
  mcpToolCall: "调用 MCP 工具",
  webSearch: "搜索网络",
  imageGeneration: "生成图片",
};

/** Names a Codex step by what it did — the command, the query, the tool — so ten steps don't all read "执行命令". */
export function codexActivityLabel(item: Record<string, unknown>, type: string): string {
  return codexActivity(item, type).label;
}

/** A Codex item as a step: its kind, a short name, and what to show when it is opened. */
export function codexActivity(item: Record<string, unknown>, type: string): Omit<ChatActivity, "id" | "status"> {
  const text = (key: string) => { const value = item[key]; return typeof value === "string" ? value.trim() : ""; };
  if (text("title")) return { label: text("title") };
  if (type === "commandExecution" && text("command")) {
    const command = shellCommand(text("command"));
    const output = typeof item.aggregatedOutput === "string" ? tail(item.aggregatedOutput.trimEnd(), 4_000) : "";
    const exit = typeof item.exitCode === "number" && item.exitCode !== 0 ? `\n退出码 ${item.exitCode}` : "";
    const detail = `$ ${command}${output ? `\n${output}` : ""}${exit}`;
    const actions = exploreActions(item.commandActions);
    return actions ? { kind: "explore", label: actions.map(describeExplore).join("，"), actions, detail } : { kind: "command", label: command, detail };
  }
  if (type === "fileChange") {
    const changes = (Array.isArray(item.changes) ? item.changes : []).map(record).filter((c): c is Record<string, unknown> => Boolean(c));
    const diffs = changes.map((change) => typeof change.diff === "string" ? change.diff : "");
    const counted = diffs.map(diffStat);
    const names = changes.map((change) => typeof change.path === "string" ? change.path.split(/[\\/]/).pop()! : "").filter(Boolean);
    return {
      kind: "edit", label: names.length > 2 ? `${names.slice(0, 2).join("、")} 等 ${names.length} 个文件` : names.join("、") || CODEX_LABELS.fileChange!,
      added: counted.reduce((sum, c) => sum + c.added, 0), removed: counted.reduce((sum, c) => sum + c.removed, 0),
      detail: tail(diffs.filter(Boolean).join("\n"), 8_000) || undefined,
    };
  }
  if (type === "webSearch") {
    const action = record(item.action);
    const url = typeof action?.url === "string" ? action.url : "";
    const label = text("query") || url || CODEX_LABELS.webSearch!;
    return { kind: "search", label };
  }
  if (type === "mcpToolCall" && text("tool")) {
    const error = stringAt(item, "error", "message");
    return { kind: "tool", label: [text("server"), text("tool")].filter(Boolean).join(" · "), detail: error || undefined };
  }
  if (type === "imageGeneration") return { kind: "image", label: CODEX_LABELS.imageGeneration! };
  return { label: CODEX_LABELS[type] ?? type };
}

/** Read, search and list actions of a command made only of those; null when it does anything else. */
function exploreActions(value: unknown): ExploreAction[] | null {
  const actions = (Array.isArray(value) ? value : []).map(record);
  if (!actions.length) return null;
  const mapped: ExploreAction[] = [];
  for (const action of actions) {
    const at = (key: string) => { const value = action?.[key]; return typeof value === "string" ? value : ""; };
    if (action?.type === "read") mapped.push({ type: "read", target: at("name") || at("path").split(/[\\/]/).pop() || "" });
    else if (action?.type === "search") mapped.push({ type: "search", target: at("query") || at("path") });
    else if (action?.type === "listFiles") mapped.push({ type: "list", target: at("path") || "." });
    else return null;
  }
  return mapped;
}

const describeExplore = (action: ExploreAction) =>
  `${{ read: "读取", search: "搜索", list: "列出" }[action.type]} ${action.target}`.trim();

/** Added and removed lines of a unified diff, headers excluded. */
export function diffStat(diff: string): { added: number; removed: number } {
  let added = 0; let removed = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) added++;
    else if (line.startsWith("-")) removed++;
  }
  return { added, removed };
}

const tail = (text: string, limit: number) => text.length > limit ? `…${text.slice(-limit)}` : text;

/** The bold heading a reasoning summary opens with (`**Checking files**`), once it is complete. */
export function reasoningHeading(summary: string): string {
  const bold = /^\s*\*\*([^*\n]+)\*\*/.exec(summary);
  return bold ? bold[1]!.trim() : "";
}

function codexPlan(params: unknown): ChatPlan | null {
  const steps = arrayAt(params, "plan").map(record).flatMap((step) => {
    const text = typeof step?.step === "string" ? step.step.trim() : "";
    const status: PlanStatus = step?.status === "completed" ? "completed" : step?.status === "inProgress" ? "inProgress" : "pending";
    return text ? [{ step: text, status }] : [];
  });
  if (!steps.length) return null;
  const explanation = stringAt(params, "explanation");
  return { steps, ...(explanation ? { explanation } : {}) };
}

/** The command a user would recognise: the script inside `zsh -lc '…'`, on one line. */
function shellCommand(command: string): string {
  const wrapped = /^(?:\S*\/)?(?:ba|z)?sh\s+-l?c\s+(?:(['"])([\s\S]*)\1|([^'"\s][\s\S]*))$/.exec(command);
  const inner = !wrapped ? command : wrapped[3] ?? wrapped[2]!.replace(wrapped[1] === "'" ? /'\\''/g : /\\"/g, wrapped[1]!);
  return inner.replace(/\s+/g, " ").trim();
}
