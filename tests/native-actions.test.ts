import { describe, expect, it, vi } from "vitest";
import { forkNativeMessage, NativeSessionActions, type PromptSession } from "../src/client/native-actions";
import { modelSourceKey, originalModelSources, selectDefaultFlash, selectOriginalModel, type ModelDirectory, type ModelDirectorySnapshot, type NativeResult } from "../src/client/native-models";

function directory() {
  const snapshot: ModelDirectorySnapshot = { status: "ready", current: null, groups: [{ id: "provider/custom", name: "原模型分组", models: [
    { id: "deepseek-pro", name: "Pro" }, { id: "deepseek-flash", name: "Flash", reasoning: { efforts: [{ id: "high" }] } },
  ] }] };
  const select = vi.fn(async () => ({ ok: true as const, value: undefined }));
  const value: ModelDirectory = { store: { getSnapshot: () => snapshot, subscribe: () => () => {} }, load: async () => snapshot, select };
  return { snapshot, value, select };
}
describe("original picker using native catalog", () => {
  it("preserves provider identities, labels and reasoning choices", () => {
    const { snapshot } = directory();
    const source = originalModelSources(snapshot)[0]!;
    expect(source.key).toBe("harness:provider%2Fcustom");
    expect(source.label).toBe("原模型分组");
    expect(source.models[1]?.efforts).toEqual(["high"]);
  });
  it("chooses only deepseek-flash for a new session, regardless of catalog order", async () => {
    const { value, select } = directory();
    await selectDefaultFlash(value);
    expect(select).toHaveBeenCalledExactlyOnceWith({ provider: "provider/custom", model: "deepseek-flash" });
  });
  it("never falls back to Pro when Flash is missing", async () => {
    const { value, select, snapshot } = directory();
    snapshot.groups[0]!.models.pop();
    await expect(selectDefaultFlash(value)).rejects.toThrow("Configure deepseek-flash");
    expect(select).not.toHaveBeenCalled();
  });
  it("rejects stale models and unavailable effort levels before changing the session", async () => {
    const { value, select } = directory();
    await expect(selectOriginalModel(value, modelSourceKey("provider/custom"), "removed")).rejects.toThrow("no longer");
    await expect(selectOriginalModel(value, modelSourceKey("provider/custom"), "deepseek-flash", "maximum")).rejects.toThrow("reasoning");
    expect(select).not.toHaveBeenCalled();
  });
  it("keeps the native selection error visible without retrying another model", async () => {
    const { value } = directory();
    value.select = vi.fn(async () => ({ ok: false as const, error: { code: "unavailable", message: "provider offline" } }));
    await expect(selectOriginalModel(value, modelSourceKey("provider/custom"), "deepseek-flash", "high")).rejects.toThrow("unavailable: provider offline");
    expect(value.select).toHaveBeenCalledTimes(1);
  });
});
function session(id = "owned") {
  const prompt = vi.fn(async () => ({ ok: true as const, value: undefined }));
  const cancel = vi.fn(async () => ({ ok: true as const, value: undefined }));
  const value: PromptSession = { getSnapshot: () => ({ sessionId: id, running: false, openState: "open" }), subscribe: () => () => {}, prompt, cancel };
  return { value, prompt, cancel };
}
describe("addressed native user actions", () => {
  it("submits the user's exact text once through the native prompt contract", async () => {
    const f = session(), actions = new NativeSessionActions("owned", () => f.value);
    await actions.submit({ text: "  保留原文\n", mode: "steer" });
    expect(f.prompt).toHaveBeenCalledExactlyOnceWith([{ type: "text", text: "  保留原文\n" }], "steer", undefined);
  });
  it("never sends to a replacement/other session or after closing the view", async () => {
    const f = session("other"), actions = new NativeSessionActions("owned", () => f.value);
    await expect(actions.submit({ text: "question" })).rejects.toThrow("addressed");
    actions.dispose();
    await expect(actions.cancel()).rejects.toThrow("closed");
    expect(f.prompt).not.toHaveBeenCalled(); expect(f.cancel).not.toHaveBeenCalled();
  });
  it("does not silently discard unsupported attachments or blank input", async () => {
    const f = session(), actions = new NativeSessionActions("owned", () => f.value);
    await expect(actions.submit({ text: "question", attachments: [{ name: "a.png" }] })).rejects.toThrow("not connected");
    await expect(actions.submit({ text: "  " })).rejects.toThrow("Enter");
    expect(f.prompt).not.toHaveBeenCalled();
  });
  it("prevents duplicate submit while the accepted request is pending", async () => {
    const f = session(); let finish!: () => void;
    f.value.prompt = vi.fn(() => new Promise<NativeResult>(resolve => { finish = () => resolve({ ok: true, value: undefined }); }));
    const actions = new NativeSessionActions("owned", () => f.value);
    const first = actions.submit({ text: "question" });
    await expect(actions.submit({ text: "question" })).rejects.toThrow("still being submitted");
    finish(); await first;
    expect(f.value.prompt).toHaveBeenCalledTimes(1);
  });
  it("honors a pre-aborted request and only cancels an explicitly addressed turn", async () => {
    const f = session(), actions = new NativeSessionActions("owned", () => f.value);
    const controller = new AbortController(); controller.abort();
    await expect(actions.submit({ text: "question" }, controller.signal)).rejects.toThrow();
    expect(f.prompt).not.toHaveBeenCalled();
    await actions.cancel();
    expect(f.cancel).toHaveBeenCalledTimes(1);
    actions.dispose();
    expect(f.cancel).toHaveBeenCalledTimes(1);
  });
  it("branches at the final durable sequence and refuses an unsettled assistant", async () => {
    const service = { fork: vi.fn(async () => "child") };
    await expect(forkNativeMessage(service, "owned", { key: "a", kind: "assistant-step", data: { finalNode: { seq: 23 } } })).resolves.toBe("child");
    expect(service.fork).toHaveBeenCalledWith({ sessionId: "owned", atSeq: 23, increaseTitle: true });
    await expect(forkNativeMessage(service, "owned", { key: "a", kind: "assistant-step", data: {} })).rejects.toThrow("durable");
    expect(service.fork).toHaveBeenCalledTimes(1);
  });
});
