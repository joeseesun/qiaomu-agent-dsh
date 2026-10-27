// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, getByRole, getByLabelText, waitFor } from "@testing-library/dom";
import type { App } from "obsidian";
import type QiaomuAgentPlugin from "../src/main";

const host = vi.hoisted(() => ({ language: "zh" }));
vi.mock("obsidian", () => ({
  getLanguage: () => host.language,
  Platform: { isDesktopApp: true, isMobile: false },
  setIcon: (el: HTMLElement, icon: string) => { el.dataset.icon = icon; },
  Notice: class {},
  Modal: class {
    modalEl = document.createElement("div");
    titleEl = this.modalEl.appendChild(document.createElement("div"));
    contentEl = this.modalEl.appendChild(document.createElement("div"));
    constructor(public app: App) {}
    open() { document.body.appendChild(this.modalEl); this.onOpen(); }
    close() { this.onClose(); this.modalEl.remove(); }
    onOpen() {} onClose() {}
  },
  ToggleComponent: class {
    toggleEl: HTMLElement;
    input: HTMLInputElement;
    constructor(parent: HTMLElement) { this.toggleEl = parent.appendChild(document.createElement("div")); this.input = this.toggleEl.appendChild(document.createElement("input")); this.input.type = "checkbox"; }
    setValue(value: boolean) { this.input.checked = value; return this; }
    onChange(fn: (value: boolean) => void) { this.input.onchange = () => fn(this.input.checked); return this; }
    setDisabled(value: boolean) { this.input.disabled = value; return this; }
  },
}));

import { ProviderModal } from "../src/ui/provider-settings";
import { normalizeSettings } from "../src/defaults";
import { addManualProviderModel } from "../src/services/provider-models";
import { newProvider } from "../src/services/model-sources";

type Options = { cls?: string; text?: string; type?: string; href?: string; attr?: Record<string, string> };
function create(this: HTMLElement, tag: string, options: Options = {}) {
  const el = this.ownerDocument.createElement(tag);
  if (options.cls) el.className = options.cls;
  if (options.text) el.textContent = options.text;
  if (options.type) el.setAttribute("type", options.type);
  if (options.href) el.setAttribute("href", options.href);
  for (const [key, value] of Object.entries(options.attr ?? {})) el.setAttribute(key, value);
  this.appendChild(el); return el;
}
Object.assign(HTMLElement.prototype, {
  createEl: create,
  createDiv(this: HTMLElement, options: Options) { return create.call(this, "div", options); },
  createSpan(this: HTMLElement, options: Options) { return create.call(this, "span", options); },
  empty(this: HTMLElement) { this.replaceChildren(); },
  addClass(this: HTMLElement, ...cls: string[]) { this.classList.add(...cls); },
  setText(this: HTMLElement, text: string) { this.textContent = text; },
});

function setup(enabled = false) {
  const provider = addManualProviderModel(newProvider("deepseek", []), "deepseek-flash", "Flash");
  if (!enabled) { provider.enabledModels = []; provider.model = ""; }
  const settings = normalizeSettings({ providers: [provider] });
  const saveSettings = vi.fn().mockResolvedValue(undefined);
  const plugin = { settings, saveSettings } as unknown as QiaomuAgentPlugin;
  const app = { secretStorage: { getSecret: () => "" } } as unknown as App;
  const modal = new ProviderModal(app, plugin, provider.id, () => {});
  modal.open();
  return { settings, saveSettings, modal, root: modal.modalEl };
}
const input = (root: HTMLElement, name: string, value: string) => fireEvent.input(getByLabelText(root, name), { target: { value } });
afterEach(() => { document.body.replaceChildren(); host.language = "zh"; vi.clearAllMocks(); });

describe("provider model controls", () => {
  it("offers editing and deletion for a disabled model and preserves disabled status after an edit", async () => {
    const { root, settings, saveSettings } = setup();
    fireEvent.click(getByRole(root, "button", { name: "编辑模型 · Flash" }));
    expect(getByLabelText(root, "模型 ID")).toBe(document.activeElement);
    input(root, "模型 ID", "deepseek-flash-new");
    input(root, "显示名称（可选）", "My Flash");
    fireEvent.click(getByRole(root, "button", { name: "保存修改" }));
    await waitFor(() => expect(getByRole(root, "button", { name: "编辑模型 · My Flash" })).toBe(document.activeElement));
    expect(getByRole(root, "button", { name: "删除模型 · My Flash" })).toBeTruthy();
    expect(settings.providers[0]?.enabledModels).toEqual([]);
    expect(saveSettings).toHaveBeenCalledTimes(1);
  });
  it("retains an edit draft and the original data on failed save, then retries", async () => {
    const { root, settings, saveSettings } = setup();
    fireEvent.click(getByRole(root, "button", { name: "编辑模型 · Flash" }));
    input(root, "显示名称（可选）", "Retry name");
    saveSettings.mockRejectedValueOnce(new Error("disk full"));
    fireEvent.click(getByRole(root, "button", { name: "保存修改" }));
    await waitFor(() => expect(root.querySelector('[role="alert"]')?.textContent).toContain("disk full"));
    expect((getByLabelText(root, "显示名称（可选）") as HTMLInputElement).value).toBe("Retry name");
    expect(settings.providers[0]?.manualModels?.[0]?.name).toBe("Flash");
    fireEvent.click(getByRole(root, "button", { name: "保存修改" }));
    await waitFor(() => expect(settings.providers[0]?.manualModels?.[0]?.name).toBe("Retry name"));
  });
  it("allows parameters on disabled models without losing identity drafts", async () => {
    const { root, settings } = setup();
    fireEvent.click(getByRole(root, "button", { name: "编辑模型 · Flash" }));
    input(root, "显示名称（可选）", "Unsaved alias");
    fireEvent.change(getByRole(root, "spinbutton", { name: "上下文窗口" }), { target: { value: "12345" } });
    await waitFor(() => expect(settings.providers[0]?.modelOptions?.["deepseek-flash"]?.contextWindow).toBe(12345));
    expect((getByLabelText(root, "显示名称（可选）") as HTMLInputElement).value).toBe("Unsaved alias");
    expect(settings.providers[0]?.enabledModels).toEqual([]);
    fireEvent.click(getByRole(root, "button", { name: "取消" }));
    expect(settings.providers[0]?.manualModels?.[0]?.name).toBe("Flash");
  });
  it("confirms the exact model, cancels without saving, and handles delete failure before retry", async () => {
    const { root, settings, saveSettings } = setup(true);
    const open = () => { fireEvent.click(getByRole(root, "button", { name: "删除模型 · Flash" })); return document.querySelector<HTMLElement>(".qa-model-removal-modal")!; };
    let confirmation = open();
    expect(confirmation.textContent).toContain("deepseek-flash");
    expect(confirmation.textContent).toContain("这是默认模型");
    fireEvent.click(getByRole(confirmation, "button", { name: "取消" }));
    expect(saveSettings).not.toHaveBeenCalled();
    confirmation = open();
    saveSettings.mockRejectedValueOnce(new Error("disk full"));
    fireEvent.click(getByRole(confirmation, "button", { name: "确认删除" }));
    await waitFor(() => expect(confirmation.querySelector('[role="alert"]')?.textContent).toContain("disk full"));
    expect(settings.providers[0]?.model).toBe("deepseek-flash");
    fireEvent.click(getByRole(confirmation, "button", { name: "确认删除" }));
    await waitFor(() => expect(document.querySelector(".qa-model-removal-modal")).toBeNull());
    expect(settings.providers[0]?.model).toBe("");
    expect(root.querySelector(".qa-ms-model")).toBeNull();
  });
  it("renders the new controls and confirmation in English", () => {
    host.language = "en";
    const { root } = setup();
    expect(getByRole(root, "button", { name: "Edit model · Flash" })).toBeTruthy();
    fireEvent.click(getByRole(root, "button", { name: "Delete model · Flash" }));
    expect(getByRole(document.body, "button", { name: "Confirm deletion" })).toBeTruthy();
    expect(document.body.textContent).toContain("Refresh");
  });
});
