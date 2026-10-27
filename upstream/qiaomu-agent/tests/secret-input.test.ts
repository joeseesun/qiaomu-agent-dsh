// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("obsidian", () => ({ setIcon: vi.fn(), getLanguage: () => "zh", Platform: { isMobile: true } }));
import { secretInput } from "../src/ui/secret-input";
import { mobileProviderModal } from "../src/ui/mobile-provider-modal";

// Only the host's DOM creation conveniences are shimmed; real DOM focus/events remain.
const create = function(this: HTMLElement, tag: string, options: { cls?: string; text?: string; type?: string; attr?: Record<string, string> } = {}) {
  const el = this.ownerDocument.createElement(tag);
  if (options.cls) el.className = options.cls;
  if (options.text) el.textContent = options.text;
  if (options.type) el.setAttribute("type", options.type);
  for (const [key, value] of Object.entries(options.attr ?? {})) el.setAttribute(key, value);
  this.appendChild(el); return el;
};
Object.assign(HTMLElement.prototype, {
  createEl: create,
  createDiv(this: HTMLElement, options: Parameters<typeof create>[1]) { return create.call(this, "div", options); },
  createSpan(this: HTMLElement, options: Parameters<typeof create>[1]) { return create.call(this, "span", options); },
  setText(this: HTMLElement, text: string) { this.textContent = text; },
});
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };
let read: ReturnType<typeof vi.fn>;
function setup() {
  const parent = document.body.appendChild(document.createElement("div"));
  const input = secretInput(parent, "API Key", "粘贴 API Key");
  const paste = parent.querySelector<HTMLButtonElement>(".qa-secret-paste")!;
  const status = parent.querySelector("[role=status]")!;
  return { parent, input, paste, status };
}
beforeEach(() => {
  read = vi.fn().mockResolvedValue("  qa-dummy-key  \n");
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { readText: read } });
});
afterEach(() => { document.body.innerHTML = ""; vi.restoreAllMocks(); });
describe("explicit secret paste", () => {
  it("reads only on click, updates form draft, stays masked and never focuses the input", async () => {
    const { input, paste, status } = setup(); const changed = vi.fn(); input.addEventListener("input", changed);
    expect(read).not.toHaveBeenCalled(); paste.focus(); paste.click(); await tick();
    expect(read).toHaveBeenCalledTimes(1); expect(changed).toHaveBeenCalledTimes(1);
    expect(input.value).toBe("qa-dummy-key"); expect(input.type).toBe("password");
    expect(document.activeElement).toBe(paste); expect(status.textContent).toBe("已粘贴");
  });
  it.each(["", "not a key"])("preserves the current draft on empty or invalid clipboard: %s", async value => {
    const { input, paste, status } = setup(); input.value = "existing"; read.mockResolvedValue(value);
    paste.click(); await tick(); expect(input.value).toBe("existing"); expect(status.textContent).not.toBe(""); expect(paste.disabled).toBe(false);
  });
  it("handles permission denial without exposing errors or stealing focus", async () => {
    const { input, paste, status } = setup(); input.value = "existing"; read.mockRejectedValue(new Error("private error"));
    paste.focus(); paste.click(); await tick(); expect(input.value).toBe("existing"); expect(document.activeElement).toBe(paste);
    expect(status.textContent).toContain("无法读取剪贴板"); expect(status.textContent).not.toContain("private");
  });
  it.each(["edit", "close"])("ignores late clipboard results after %s", async action => {
    let resolve!: (value: string) => void; read.mockReturnValue(new Promise<string>(r => { resolve = r; }));
    const { input, paste, parent } = setup(); paste.click(); paste.click(); expect(read).toHaveBeenCalledTimes(1);
    if (action === "edit") { input.value = "newer"; input.dispatchEvent(new Event("input")); } else parent.remove();
    resolve("stale-key"); await tick(); expect(input.value).not.toBe("stale-key");
  });
  it("keeps reveal independent of pasting and preserves selection", () => {
    const { input, parent } = setup(); input.value = "dummy-key"; input.setSelectionRange(2, 4);
    const toggle = parent.querySelector<HTMLButtonElement>(".qa-secret-toggle")!;
    toggle.click(); expect(input.type).toBe("text"); expect(input.selectionStart).toBe(2); expect(input.selectionEnd).toBe(4);
    toggle.click(); expect(input.type).toBe("password"); expect(read).not.toHaveBeenCalled();
  });
  it("uses a non-input mobile focus target and removes viewport listeners on close", () => {
    const { parent, input } = setup(); const content = parent;
    const add = vi.spyOn(window, "addEventListener"); const remove = vi.spyOn(window, "removeEventListener");
    const dispose = mobileProviderModal(parent, content);
    expect(document.activeElement).toBe(parent); expect(document.activeElement).not.toBe(input);
    const callback = add.mock.calls.find(([name]) => name === "resize")?.[1]; expect(callback).toBeTruthy();
    dispose(); expect(remove).toHaveBeenCalledWith("resize", callback); expect(parent.classList.contains("qa-mobile-provider")).toBe(false);
  });
});
