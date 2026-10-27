import { describe, expect, it } from "vitest";
import { addManualProviderModel, editProviderModel, removeProviderModel, providerModels, refreshProviderModels } from "../src/services/provider-models";
import { apiSelectionKey, chooseModel, exposedModels, newProvider, persistProviderModelChange, upsertProvider } from "../src/services/model-sources";
import { normalizeSettings } from "../src/defaults";
const model = (id: string, name = id) => ({ id, name, efforts: [] });

describe("remote discovery and manual entries coexist", () => {
  it("refreshes discovery without opting new models into the picker", () => {
    const p = refreshProviderModels({ ...newProvider("custom", []), enabledModels: [] }, [model("listed")]);
    expect(providerModels(p).map(x => x.id)).toEqual(["listed"]);
    expect(exposedModels(p)).toEqual([]);
  });
  it("retains a disabled manual model, its alias and parameters through refresh and restart", () => {
    let p = addManualProviderModel(newProvider("custom", []), "my-model", "日常模型");
    p = { ...p, enabledModels: [], model: "", modelOptions: { "my-model": { temperature: 0.4 } } };
    p = refreshProviderModels(p, [model("listed")]);
    p = normalizeSettings({ providers: [p] }).providers[0]!;
    expect(providerModels(p).map(x => x.id)).toEqual(["listed", "my-model"]);
    expect(p.manualModels).toEqual([{ id: "my-model", name: "日常模型" }]);
    expect(p.modelOptions?.["my-model"]?.temperature).toBe(0.4);
    expect(exposedModels(p)).toEqual([]);
    expect(exposedModels({ ...p, enabledModels: ["my-model"] })[0]?.name).toBe("日常模型");
  });
  it("merges an exact ID across both sources without overwriting its alias", () => {
    let p = addManualProviderModel(newProvider("custom", []), "model-v1", "My name");
    p = refreshProviderModels(p, [{ ...model("model-v1", "Vendor name"), vision: true }, model("model-v1")]);
    expect(providerModels(p)).toHaveLength(1);
    expect(providerModels(p)[0]?.name).toBe("My name");
    expect(p.enabledModels).toEqual(["model-v1"]);
    expect(() => addManualProviderModel(p, "model-v1")).toThrow("已在列表");
  });
  it("keeps dated and provider-prefixed IDs distinct even when names match", () => {
    const p = refreshProviderModels(newProvider("custom", []), [model("model", "Same"), model("vendor/model", "Same"), model("model-20260929", "Same")]);
    expect(providerModels(p)).toHaveLength(3);
  });
  it("preserves selected models missing from a refreshed catalog", () => {
    const p = refreshProviderModels({ ...newProvider("custom", []), models: [model("old")], fetchedAt: 1, enabledModels: ["old"], model: "old" }, []);
    expect(providerModels(p).map(x => x.id)).toEqual(["old"]);
    expect(p.model).toBe("old");
    expect(p.manualModels).toContainEqual({ id: "old", name: "old" });
  });
  it("migrates old ID-only manual entries and old manually connected providers", () => {
    const old = normalizeSettings({ providers: [{ ...newProvider("custom", []), enabledModels: ["legacy"] }] }).providers[0]!;
    expect(old.manualModels).toContainEqual({ id: "legacy", name: "legacy" });
    const previous = refreshProviderModels({ ...newProvider("custom", []), models: [model("kimi-k3")], enabledModels: ["kimi-k3"] }, [model("new")]);
    expect(providerModels(previous).map(x => x.id)).toEqual(["new", "kimi-k3"]);
  });
});

describe("model management", () => {
  const configured = () => {
    const p = addManualProviderModel(newProvider("custom", []), "old", "Original");
    return { ...p, modelOptions: { old: { contextWindow: 10000, reasoning: false } } };
  };
  it("edits a disabled model without enabling it, retaining its parameters after restart", () => {
    const p = editProviderModel({ ...configured(), enabledModels: [], model: "" }, "old", " new ", " 新名称 ");
    const restored = normalizeSettings({ providers: [p] }).providers[0]!;
    expect(providerModels(restored)).toEqual([{ id: "new", name: "新名称", efforts: [] }]);
    expect(restored.enabledModels).toEqual([]);
    expect(restored.model).toBe("");
    expect(restored.modelOptions).toEqual({ new: { contextWindow: 10000, reasoning: false } });
  });
  it("renames a discovered default and does not resurrect the old ID on refresh", () => {
    const p = { ...configured(), models: [{ ...model("old", "Vendor name"), vision: true }], fetchedAt: 1 };
    const edited = editProviderModel(p, "old", "new", "New name");
    const refreshed = refreshProviderModels(edited, [model("old"), model("other")]);
    expect(providerModels(refreshed).map(m => m.id)).toEqual(["other", "new"]);
    expect(providerModels(refreshed).find(m => m.id === "new")?.vision).toBeUndefined();
    expect(refreshed.model).toBe("new");
    expect(refreshed.enabledModels).toEqual(["new"]);
    expect(p.model).toBe("old");
  });
  it("keeps discovery capabilities when editing only the display name", () => {
    const p = refreshProviderModels(configured(), [{ ...model("old"), vision: true }]);
    const edited = refreshProviderModels(editProviderModel(p, "old", "old", "My alias"), [{ ...model("old", "Vendor"), vision: true }]);
    expect(providerModels(edited)[0]).toMatchObject({ id: "old", name: "My alias", vision: true });
  });
  it.each(["", "has space", "x".repeat(201), "other"])("rejects invalid or duplicate IDs without changing the source: %s", id => {
    const p = addManualProviderModel(configured(), "other");
    const before = structuredClone(p);
    expect(() => editProviderModel(p, "old", id)).toThrow();
    expect(p).toEqual(before);
  });
  it("removes a default from both sources, clears options, and selects the remaining enabled model", () => {
    const p = refreshProviderModels(addManualProviderModel(configured(), "other"), [model("old"), model("other")]);
    const removed = removeProviderModel(p, "old");
    const restored = normalizeSettings({ providers: [refreshProviderModels(removed, [model("old"), model("other")])] }).providers[0]!;
    expect(providerModels(restored).map(m => m.id)).toEqual(["other"]);
    expect(restored.enabledModels).toEqual(["other"]);
    expect(restored.model).toBe("other");
    expect(restored.modelOptions?.old).toBeUndefined();
    expect(restored.manualModels?.some(m => m.id === "old")).toBe(false);
  });
  it("removes the last legacy model without migration re-adding it and allows explicit re-add", () => {
    const p = { ...newProvider("custom", []), models: [model("old")], enabledModels: ["old"], model: "old" };
    const removed = normalizeSettings({ providers: [removeProviderModel(p, "old")] }).providers[0]!;
    expect(providerModels(removed)).toEqual([]);
    expect(removed.model).toBe("");
    expect(removed.enabledModels).toEqual([]);
    const added = addManualProviderModel(removed, "old", "Restored");
    expect(providerModels(added).map(m => m.id)).toEqual(["old"]);
    expect(added.removedModels).not.toContain("old");
  });
  it.each(["rename", "delete"])("updates active selection and recent models on %s, with disk-failure rollback", async action => {
    const settings = normalizeSettings({ providers: [configured()] });
    const original = settings.providers[0]!;
    chooseModel(settings, `api:${original.id}`, "old");
    const key = apiSelectionKey(original);
    settings.modelSelections![key]!.effort = "high";
    settings.recentModels.push({ source: "api:unrelated", model: "old" });
    const before = structuredClone(settings);
    const nextId = action === "rename" ? "new" : undefined;
    const next = nextId ? editProviderModel(original, "old", nextId, "New") : removeProviderModel(original, "old");
    await expect(persistProviderModelChange(settings, next, "old", nextId, async () => { throw new Error("disk full"); })).rejects.toThrow("disk full");
    expect(settings).toEqual(before);
    await persistProviderModelChange(settings, next, "old", nextId, async () => {});
    expect(settings.api.model).toBe(nextId ?? "");
    expect(settings.modelSelections?.[key]).toEqual({ model: nextId ?? "", effort: "" });
    expect(settings.recentModels).toEqual([...(nextId ? [{ source: `api:${original.id}`, model: nextId }] : []), { source: "api:unrelated", model: "old" }]);
  });
  it("does not change another active provider when removing a model", async () => {
    const settings = normalizeSettings({ providers: [configured()] });
    const original = settings.providers[0]!;
    const other = addManualProviderModel(newProvider("deepseek", []), "deepseek-flash");
    upsertProvider(settings, other);
    chooseModel(settings, `api:${other.id}`, "deepseek-flash");
    const before = structuredClone(settings.api);
    await persistProviderModelChange(settings, removeProviderModel(original, "old"), "old", undefined, async () => {});
    expect(settings.api).toEqual(before);
  });
  it("leaves another account's selection alone when it uses the same endpoint and model ID", async () => {
    const settings = normalizeSettings({ providers: [configured()] });
    const original = settings.providers[0]!;
    const other = { ...configured(), id: "other-account", secretId: "other-key" };
    upsertProvider(settings, other);
    chooseModel(settings, `api:${other.id}`, "old");
    const before = structuredClone(settings.modelSelections);
    await persistProviderModelChange(settings, removeProviderModel(original, "old"), "old", undefined, async () => {});
    expect(settings.api.model).toBe("old");
    expect(settings.modelSelections).toEqual(before);
  });
});
