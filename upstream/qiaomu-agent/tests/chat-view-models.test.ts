import { describe, expect, it, vi } from "vitest";
import { ChatView } from "../src/chat-view";
import { normalizeSettings } from "../src/defaults";
import type { ModelSource } from "../src/services/model-sources";

vi.mock("obsidian", async (importOriginal) => ({
  ...await importOriginal<typeof import("obsidian")>(),
  Component: class {}, ItemView: class {}, Modal: class {}, FuzzySuggestModal: class {},
  MarkdownView: class {}, Menu: class {}, Notice: class {}, TFile: class {}, TFolder: class {},
  Vault: class {}, WorkspaceLeaf: class {}, PluginSettingTab: class {}, Setting: class {}, normalizePath: (path: string) => path,
}));

function setup() {
  const settings = normalizeSettings({ backendKind: "cli", preferredCli: "codex" });
  settings.agentModelCache.codex = { models: [{ id: "old", name: "Old", efforts: ["low"] }], fetchedAt: 1 };
  settings.modelSelections = { "cli:codex": { model: "old", effort: "low" } };
  const prepare = vi.fn(async () => {});
  const view = Object.create(ChatView.prototype) as {
    refreshControls(): void;
    modelSources(): ModelSource[]; render(): void; running(): boolean; selectionKey(): string;
  };
  let sources: ModelSource[] = [];
  Object.assign(view, {
    root: {}, sourceState: new Map(), selectedBackend: "cli:codex",
    app: { secretStorage: { getSecret: () => "" } },
    plugin: { settings, skillService: { getVaultRoot: () => null }, backendService: {
      effectiveSelection: () => "cli:codex",
      getBackendOptions: () => [{ value: "cli:codex", ready: true }],
      getDetections: () => [{ id: "codex", label: "Codex", callable: true }],
      resolve: () => ({ id: "cli:codex", prepare }),
    } },
    running: () => false, selectionKey: () => "cli:codex",
    render: () => { sources = view.modelSources(); },
  });
  return { view, settings, prepare, sources: () => sources };
}

describe("open conversation model catalog", () => {
  it.each([false, true])("uses refreshed settings without switching agents (streaming=%s)", (streaming) => {
    const { view, settings, prepare, sources } = setup();
    view.refreshControls();
    expect(sources()[0]!.models[0]!.id).toBe("old");
    view.running = () => streaming;
    prepare.mockClear();
    settings.agentModelCache.codex = { models: [{ id: "new", name: "New", efforts: ["high"] }], fetchedAt: 2 };
    view.refreshControls();
    expect(sources()[0]!.models).toEqual(settings.agentModelCache.codex.models);
    expect(settings.modelSelections?.["cli:codex"]).toEqual({ model: "old", effort: "low" });
    if (streaming) expect(prepare).not.toHaveBeenCalled();
  });

  it("updates enabled and manual entries, including an empty refreshed catalog", () => {
    const { view, settings, sources } = setup();
    view.refreshControls();
    settings.agentCustomModels.codex = ["manual"];
    settings.agentEnabledModels.codex = ["manual"];
    view.refreshControls();
    expect(sources()[0]!.models.map((model) => model.id)).toEqual(["manual"]);
    expect(sources()[0]!.showDefault).toBe(false);
    settings.agentEnabledModels.codex = [""];
    settings.agentModelCache.codex = { models: [], fetchedAt: 3 };
    view.refreshControls();
    expect(sources()[0]!.models).toEqual([]);
    expect(sources()[0]!.loaded).toBe(false);
    expect(sources()[0]!.showDefault).toBe(true);
  });
});
