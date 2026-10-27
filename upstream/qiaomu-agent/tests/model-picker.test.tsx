// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelPicker } from "../src/ui/model-picker";
import type { ModelSource } from "../src/services/model-sources";

afterEach(cleanup);

const sources: ModelSource[] = [
  { key: "cli:codex", kind: "agent", label: "Codex", icon: "codex", models: [], loaded: false, canListModels: true },
  { key: "api:deepseek", kind: "api", label: "DeepSeek", icon: "deepseek", models: [{ id: "deepseek-chat", name: "DeepSeek V4", efforts: [] }, { id: "deepseek-reasoner", name: "DeepSeek R2", efforts: ["low", "high"] }], loaded: true },
  { key: "api:moonshot", kind: "api", label: "Kimi", icon: "moonshot", models: [{ id: "kimi-k3", name: "Kimi K3", efforts: [] }], loaded: true },
];

// Enough models that the source rail is worth showing.
const longSources: ModelSource[] = sources.map((source) => source.key === "api:deepseek"
  ? { ...source, models: [...source.models, ...Array.from({ length: 11 }, (_, index) => ({ id: `deepseek-extra-${index}`, name: `DeepSeek Extra ${index}`, efforts: [] }))] }
  : source);

function setup(overrides: Partial<Parameters<typeof ModelPicker>[0]> = {}) {
  const props = {
    sources, current: { source: "api:deepseek", model: "deepseek-chat" }, recent: [{ source: "api:moonshot", model: "kimi-k3" }],
    efforts: [], effort: "", onEffort: vi.fn(), onSelect: vi.fn(), onLoad: vi.fn(), onManage: vi.fn(), ...overrides,
  };
  return { ...render(<ModelPicker {...props} />), props };
}

describe("unified model picker", () => {
  it("groups every source, marks the current model and switches source on selection", () => {
    const { props, container } = setup();
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "筛选模型" }));
    expect(Array.from(container.querySelectorAll(".qa-picker-group")).map((el) => el.textContent)).toEqual(["DeepSeek", "Kimi"]);
    // An agent offering only its default model is a single row, and the short list needs no rail.
    expect(screen.getByRole("button", { name: /Codex\s*默认模型/ })).toBeTruthy();
    expect(screen.queryByRole("toolbar", { name: "模型来源" })).toBeNull();
    expect(screen.getByRole("button", { name: /DeepSeek V4/ }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /Kimi K3/ }));
    expect(props.onSelect).toHaveBeenCalledWith("api:moonshot", "kimi-k3");
  });

  it("filters by model or vendor, and Enter picks the first match", () => {
    const { props } = setup();
    const search = screen.getByRole("textbox", { name: "筛选模型" });
    fireEvent.change(search, { target: { value: "r2" } });
    expect(screen.queryByRole("button", { name: /Kimi K3/ })).toBeNull();
    fireEvent.keyDown(search, { key: "Enter" });
    expect(props.onSelect).toHaveBeenCalledWith("api:deepseek", "deepseek-reasoner");
    fireEvent.change(search, { target: { value: "kimi" } });
    expect(screen.getByRole("button", { name: /Kimi K3/ })).toBeTruthy();
  });

  it("keeps API search inside the models enabled in settings", () => {
    const { props } = setup();
    fireEvent.change(screen.getByRole("textbox", { name: "筛选模型" }), { target: { value: "deepseek-v5-preview" } });
    expect(screen.queryByRole("button", { name: /使用「deepseek-v5-preview」/ })).toBeNull();
    expect(props.onSelect).not.toHaveBeenCalled();
  });

  it("does not offer disabled API models through recent history", () => {
    setup({ sources: longSources, recent: [{ source: "api:deepseek", model: "disabled-model" }] });
    fireEvent.click(screen.getByRole("button", { name: "最近使用" }));
    expect(screen.queryByRole("button", { name: /disabled-model/ })).toBeNull();
  });

  it("does not reintroduce hidden local models through search or recent history", () => {
    const curated = [{ ...sources[0]!, models: [{ id: "k3", name: "K3", efforts: [] }], showDefault: false, allowCustom: false, loaded: true }, ...longSources.slice(1)];
    setup({ sources: curated, recent: [{ source: "cli:codex", model: "hidden" }] });
    fireEvent.change(screen.getByRole("textbox", { name: "筛选模型" }), { target: { value: "hidden" } });
    expect(screen.queryByRole("button", { name: /使用「hidden」/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Codex" }));
    expect(screen.queryByRole("button", { name: "默认模型" })).toBeNull();
  });

  it("offers loading the model list of the agent in use from the full list", () => {
    const { props } = setup({ current: { source: "cli:codex", model: "" } });
    fireEvent.click(screen.getByRole("button", { name: "获取模型列表" }));
    expect(props.onLoad).toHaveBeenCalledWith("cli:codex");
  });

  it("narrows to one source from the rail, offers the agent default and lazy model loading", () => {
    const { props, container } = setup({ sources: longSources });
    fireEvent.click(screen.getByRole("button", { name: "Codex" }));
    expect(container.querySelectorAll(".qa-picker-group")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "获取模型列表" }));
    expect(props.onLoad).toHaveBeenCalledWith("cli:codex");
    fireEvent.click(screen.getByRole("button", { name: "默认模型" }));
    expect(props.onSelect).toHaveBeenCalledWith("cli:codex", "");
  });

  it("does not offer a model-list request for a CLI without a list capability", () => {
    setup({ sources: [{ key: "cli:grok", kind: "agent", label: "Grok CLI", models: [], loaded: false }], current: { source: "cli:grok", model: "" } });
    expect(screen.getByRole("button", { name: "默认模型" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "获取模型列表" })).toBeNull();
  });

  it("shows recent models across sources and supports keyboard navigation", () => {
    setup({ sources: longSources });
    fireEvent.click(screen.getByRole("button", { name: "最近使用" }));
    const item = screen.getByRole("button", { name: /Kimi K3\s*Kimi/ });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "筛选模型" }), { key: "ArrowDown" });
    expect(document.activeElement).toBe(item);
  });

  it("only shows reasoning effort when the model reports it", () => {
    const { props, rerender } = setup();
    expect(screen.queryByRole("radiogroup", { name: "推理强度" })).toBeNull();
    rerender(<ModelPicker {...props} efforts={["low", "high"]} effort="high" />);
    expect(screen.getByRole("radio", { name: "高" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "默认" }));
    expect(props.onEffort).toHaveBeenCalledWith("");
    fireEvent.click(screen.getByRole("button", { name: "模型设置" }));
    expect(props.onManage).toHaveBeenCalledOnce();
  });
});
