import type { AgentMessage } from "../../upstream/qiaomu-agent/src/services/chat-transport";

/** Structural contracts of injected uiSession.hooks.chat; no runtime package imports. */
export interface Source<T> {
  getSnapshot(): T;
  subscribe(listener: () => void): () => void;
}
export interface NativeNode {
  key: string;
  kind: string;
  visibility?: string;
  data: unknown;
}
export interface NativeChatSnapshot {
  order: readonly string[];
  nodes: { get(key: string): NativeNode | undefined };
}
export interface ChatProjection {
  messages: AgentMessage[];
  /** Exposed to the controller so unsupported content is never silently called migrated. */
  unsupported: readonly { key: string; kind: string }[];
}
type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue =>
  value !== null && typeof value === "object" ? value as RecordValue : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const string = (value: unknown): string => typeof value === "string" ? value : "";
const time = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
};

function convert(node: NativeNode): { message?: AgentMessage; unsupported: string[] } {
  if (node.visibility === "hidden") return { unsupported: [] };
  const data = record(node.data);
  const parts: AgentMessage["parts"] = [];
  const unsupported: string[] = [];
  const metadata = { createdAt: time(data.time), backend: "DeepSeek Harness" };
  if (["user", "steering", "turn-trigger"].includes(node.kind)) {
    for (const raw of array(data.content)) {
      const block = record(raw);
      if (block.type === "text") parts.push({ type: "text", text: string(block.text) });
      else unsupported.push(`${node.kind}/${string(block.type) || "unknown"}`);
    }
    return { message: { id: node.key, role: "user", metadata, parts }, unsupported };
  }
  if (node.kind === "assistant-step") {
    for (const [index, raw] of array(data.blocks).entries()) {
      const block = record(raw);
      if (block.kind === "text") {
        parts.push({ type: "text", text: string(block.text), state: data.status === "running" ? "streaming" : "done" });
      } else if (block.kind === "reasoning") {
        // Original ReplyTimeline renders activities, not raw AI SDK reasoning parts.
        const id = `${node.key}:reasoning:${index}`;
        parts.push({ type: "data-activity", id, data: { id, label: "思考过程", kind: "tool",
          status: data.status === "running" ? "running" : data.status === "interrupted" ? "cancelled" : "completed",
          detail: string(block.text),
        } });
      } else if (block.kind !== "tool-call") {
        // Tools have their own keyed node and must not be duplicated here.
        unsupported.push(`assistant/${string(block.kind) || "unknown"}`);
      }
    }
    const final = record(data.finalNode);
    return { message: { id: node.key, role: "assistant", metadata: {
      ...metadata, ...(data.status === "settled" || data.status === "interrupted" ? { finishedAt: time(final.time ?? data.time) } : {}),
    }, parts }, unsupported };
  }
  if (node.kind === "tool-call") {
    const root = record(data.root);
    const settled = root.kind === "tool-result";
    const id = string(root.callId) || node.key;
    const detail = settled ? array(root.content).flatMap(raw => {
      const block = record(raw);
      if (block.type === "text") return [string(block.text)];
      unsupported.push(`tool/${string(block.type) || "unknown"}`);
      return [];
    }).join("\n") : string(root.argsRaw);
    parts.push({ type: "data-activity", id, data: {
      id, label: string(root.name) || "工具调用", kind: "tool",
      status: settled ? root.isError ? "failed" : "completed" : root.phase === "preparing" ? "pending" : "running",
      detail: detail || undefined,
    } });
    return { message: { id: node.key, role: "assistant", metadata: { ...metadata, createdAt: time(root.time) }, parts }, unsupported };
  }
  return { unsupported: [node.kind] };
}

/** In-memory view cache only. Native snapshots remain authoritative, including retries. */
export class NativeChatProjection {
  private cache = new Map<string, { node: NativeNode; value: ReturnType<typeof convert> }>();
  private last: ChatProjection = { messages: [], unsupported: [] };
  update(snapshot: NativeChatSnapshot): ChatProjection {
    const live = new Set(snapshot.order);
    for (const key of this.cache.keys()) if (!live.has(key)) this.cache.delete(key);
    const messages: AgentMessage[] = [];
    const unsupported: { key: string; kind: string }[] = [];
    for (const key of snapshot.order) {
      const node = snapshot.nodes.get(key);
      if (!node) { this.cache.delete(key); continue; }
      let cached = this.cache.get(key);
      if (cached?.node !== node) {
        cached = { node, value: convert(node) };
        this.cache.set(key, cached);
      }
      if (cached.value.message) messages.push(cached.value.message);
      unsupported.push(...cached.value.unsupported.map(kind => ({ key, kind })));
    }
    if (messages.length === this.last.messages.length && messages.every((message, index) => message === this.last.messages[index]) &&
      unsupported.length === this.last.unsupported.length && unsupported.every((item, index) => item.key === this.last.unsupported[index]?.key && item.kind === this.last.unsupported[index]?.kind)) return this.last;
    return this.last = { messages, unsupported };
  }
  clear() { this.cache.clear(); this.last = { messages: [], unsupported: [] }; }
}

export interface SessionFace extends Source<{ running: boolean; openState: string; openError?: unknown }> {}
export interface SessionReference {
  sessionId: string;
  ready: Promise<unknown>;
  release(): void;
}
export interface SessionServices {
  sessions: { retain(id: string, options: { source: string }): SessionReference };
  uiSession: { bindingSource(ref: SessionReference): {
    value: { hooks: { session?: SessionFace; chat?: Source<NativeChatSnapshot> } };
    subscribe(listener: () => void): () => void;
  } };
}
export interface ObservedChat extends ChatProjection {
  sessionId: string;
  status: "loading" | "ready" | "unavailable" | "error";
  running: boolean;
  error?: unknown;
}

/** Owns exactly one retained session and no approvals, prompts, disk history, or polling. */
export function observeNativeChat(services: SessionServices, sessionId: string, receive: (value: ObservedChat) => void): () => void {
  const reference = services.sessions.retain(sessionId, { source: "qiaomu-agent-dsh" });
  const projection = new NativeChatProjection();
  let disposed = false;
  let stops: (() => void)[] = [];
  let stopBinding = () => {};
  let generation = 0;
  const empty = (status: ObservedChat["status"], error?: unknown) => receive({ sessionId, status, running: false, messages: [], unsupported: [], ...(error === undefined ? {} : { error }) });
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    generation++;
    stopBinding();
    for (const stop of stops.splice(0)) stop();
    projection.clear();
    reference.release();
  };
  try {
    const binding = services.uiSession.bindingSource(reference);
    const bind = () => {
      if (disposed) return;
      const current = ++generation;
      for (const stop of stops.splice(0)) stop();
      projection.clear();
      const { chat, session } = binding.value.hooks;
      if (!chat || !session) { empty("unavailable"); return; }
      const publish = () => {
        if (disposed || current !== generation) return;
        const state = session.getSnapshot();
        receive({ sessionId, ...projection.update(chat.getSnapshot()), running: state.running,
          status: state.openError ? "error" : state.openState === "open" ? "ready" : "loading",
          ...(state.openError ? { error: state.openError } : {}),
        });
      };
      stops.push(chat.subscribe(publish));
      stops.push(session.subscribe(publish));
      publish();
    };
    stopBinding = binding.subscribe(bind);
    bind();
    void reference.ready.catch(error => { if (!disposed) empty("error", error); });
  } catch (error) {
    // Release even when the active Controller generation rejects the reference.
    void reference.ready.catch(() => {});
    dispose();
    throw error;
  }
  return dispose;
}
