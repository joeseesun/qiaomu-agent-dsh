import { describe, expect, it, vi } from "vitest";
import { NativeChatProjection, observeNativeChat, type NativeNode, type ObservedChat, type SessionServices } from "../src/client/native-chat";

function store<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return { getSnapshot: () => value, subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; }, set: (next: T) => { value = next; for (const fn of [...listeners]) fn(); }, listeners };
}
const node = (key: string, kind: string, data: unknown): NativeNode => ({ key, kind, data });
const snapshot = (...nodes: NativeNode[]) => ({ order: nodes.map(n => n.key), nodes: new Map(nodes.map(n => [n.key, n])) });
const assistant = (text: string) => node("a", "assistant-step", { status: "running", time: 12, blocks: [{ kind: "text", text }] });

describe("authoritative standard chat projection", () => {
  it("restores user, reasoning and assistant text in published order", () => {
    const result = new NativeChatProjection().update(snapshot(node("u", "user", { time: 10, content: [{ type: "text", text: "问" }] }), node("a", "assistant-step", { time: 12, status: "settled", blocks: [{ kind: "reasoning", text: "思考" }, { kind: "text", text: "答" }], finalNode: { time: 15 } })));
    expect(result.messages.map(m => m.role)).toEqual(["user", "assistant"]);
    expect(result.messages[1]?.parts).toEqual([{ type: "data-activity", id: "a:reasoning:0", data: { id: "a:reasoning:0", label: "思考过程", kind: "tool", status: "completed", detail: "思考" } }, { type: "text", text: "答", state: "done" }]);
    expect(result.messages[1]?.metadata?.finishedAt).toBe(15);
  });
  it("updates the same key and replaces retracted retry text, without appending stale tokens", () => {
    const projection = new NativeChatProjection();
    projection.update(snapshot(assistant("failed attempt")));
    expect(projection.update(snapshot(assistant("retry"))).messages[0]?.parts).toEqual([{ type: "text", text: "retry", state: "streaming" }]);
  });
  it("reuses unchanged message identities and entire unchanged views", () => {
    const projection = new NativeChatProjection(), a = assistant("hello"), u = node("u", "user", { content: [] });
    const first = projection.update(snapshot(u, a));
    expect(projection.update(snapshot(u, a))).toBe(first);
    expect(projection.update(snapshot(u, assistant("hello!"))).messages[0]).toBe(first.messages[0]);
  });
  it("evicts removed nodes and respects hidden retry nodes", () => {
    const projection = new NativeChatProjection(), a = assistant("hello");
    projection.update(snapshot(a));
    expect(projection.update(snapshot({ ...a, visibility: "hidden" })).messages).toEqual([]);
    expect(projection.update(snapshot()).messages).toEqual([]);
  });
  it("tracks tool progress and failure without duplicating assistant tool-call blocks", () => {
    const projection = new NativeChatProjection();
    const a = node("a", "assistant-step", { blocks: [{ kind: "tool-call", callId: "c", name: "read" }] });
    const first = projection.update(snapshot(a, node("t", "tool-call", { root: { callId: "c", phase: "start", name: "read", argsRaw: "a.md" } })));
    expect(first.messages[0]?.parts).toEqual([]);
    expect(first.messages[1]?.parts[0]).toMatchObject({ type: "data-activity", data: { id: "c", status: "running", detail: "a.md" } });
    const last = projection.update(snapshot(node("t", "tool-call", { root: { callId: "c", kind: "tool-result", name: "read", isError: true, content: [{ type: "text", text: "denied" }] } })));
    expect(last.messages[0]?.parts[0]).toMatchObject({ data: { status: "failed", detail: "denied" } });
  });
  it("reports unsupported attachments and node kinds rather than claiming full parity", () => {
    expect(new NativeChatProjection().update(snapshot(node("u", "user", { content: [{ type: "image", url: "private" }] }), node("p", "plan", {}))).unsupported).toEqual([{ key: "u", kind: "user/image" }, { key: "p", kind: "plan" }]);
  });
});

function fixture() {
  const chat = store(snapshot(assistant("first")));
  const session = store({ running: false, openState: "open" });
  const bindingListeners = new Set<() => void>();
  const binding = { value: { hooks: { chat, session } }, subscribe: (fn: () => void) => { bindingListeners.add(fn); return () => { bindingListeners.delete(fn); }; } };
  const release = vi.fn();
  const reference = { sessionId: "owned", ready: Promise.resolve(), release };
  const services = { sessions: { retain: vi.fn(() => reference) }, uiSession: { bindingSource: vi.fn(() => binding) } };
  return { chat, session, binding, bindingListeners, services, release, reference };
}
describe("retained session lifetime", () => {
  it("subscribes without prompting or reading event history, then releases exactly once", () => {
    const f = fixture(), values: ObservedChat[] = [];
    const stop = observeNativeChat(f.services, "owned", value => values.push(value));
    expect(f.services.sessions.retain).toHaveBeenCalledWith("owned", { source: "qiaomu-agent-dsh" });
    expect(values.at(-1)).toMatchObject({ status: "ready", running: false });
    f.session.set({ running: true, openState: "open" });
    expect(values.at(-1)?.running).toBe(true);
    stop(); stop();
    expect(f.release).toHaveBeenCalledTimes(1);
    expect(f.chat.listeners.size + f.session.listeners.size + f.bindingListeners.size).toBe(0);
  });
  it("rebinds after standard hooks change and ignores old-source notifications", () => {
    const f = fixture(), values: ObservedChat[] = [];
    const stop = observeNativeChat(f.services, "owned", value => values.push(value));
    const staleListener = [...f.chat.listeners][0]!;
    const next = store(snapshot(assistant("replacement")));
    f.binding.value = { hooks: { chat: next, session: f.session } };
    for (const fn of f.bindingListeners) fn();
    const count = values.length;
    staleListener();
    expect(values).toHaveLength(count);
    expect(values.at(-1)?.messages[0]?.parts[0]).toMatchObject({ text: "replacement" });
    expect(f.chat.listeners.size).toBe(0);
    stop();
  });
  it("publishes unavailable when a provider is removed", () => {
    const f = fixture(), receive = vi.fn();
    const stop = observeNativeChat(f.services, "owned", receive);
    (f.binding as SessionServices["uiSession"] extends { bindingSource(...args: any[]): infer T } ? T : never).value = { hooks: {} };
    for (const fn of f.bindingListeners) fn();
    expect(receive).toHaveBeenLastCalledWith(expect.objectContaining({ status: "unavailable", messages: [] }));
    expect(f.chat.listeners.size).toBe(0);
    stop();
  });
  it("releases rejected generation references", () => {
    const f = fixture();
    f.services.uiSession.bindingSource.mockImplementation(() => { throw Error("generation ended"); });
    expect(() => observeNativeChat(f.services, "owned", vi.fn())).toThrow("generation ended");
    expect(f.release).toHaveBeenCalledTimes(1);
  });
  it("cleans the first subscription if a second provider fails during startup", () => {
    const f = fixture();
    f.session.subscribe = () => { throw Error("provider failed"); };
    expect(() => observeNativeChat(f.services, "owned", vi.fn())).toThrow("provider failed");
    expect(f.chat.listeners.size + f.bindingListeners.size).toBe(0);
    expect(f.release).toHaveBeenCalledTimes(1);
  });
  it("ignores asynchronous open failure after disposal", async () => {
    const f = fixture(), receive = vi.fn();
    let reject!: (error: Error) => void;
    f.reference.ready = new Promise<void>((_resolve, fail) => { reject = fail; });
    const stop = observeNativeChat(f.services, "owned", receive);
    stop();
    const count = receive.mock.calls.length;
    reject(Error("late failure"));
    await Promise.resolve();
    expect(receive).toHaveBeenCalledTimes(count);
  });
});
