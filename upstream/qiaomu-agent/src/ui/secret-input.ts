import { setIcon } from "obsidian";
import { connectionText as t } from "../i18n/connection";

/** Toggle only this draft; never read persisted secrets or rebuild the input. */
export function secretInput(parent: HTMLElement, label: string, placeholder: string): HTMLInputElement {
  const wrap = parent.createDiv({ cls: "qa-secret-input" });
  const field = wrap.createEl("label", { cls: "qa-input-label" });
  field.createSpan({ cls: "qiaomu-agent__sr-only", text: label });
  const input = field.createEl("input", { type: "password", cls: "qa-ms-input is-mono", attr: { placeholder, autocomplete: "off", spellcheck: "false", autocapitalize: "off", autocorrect: "off", enterkeyhint: "done" } });
  const labelId = `qa-secret-label-${crypto.randomUUID()}`;
  const name = wrap.createSpan({ cls: "qiaomu-agent__sr-only", text: t("showKey"), attr: { id: labelId } });
  const toggle = wrap.createEl("button", { cls: "qa-secret-toggle", attr: { type: "button", "aria-labelledby": labelId, title: t("showKey"), "aria-pressed": "false" } });
  setIcon(toggle, "eye");
  toggle.addEventListener("click", () => {
    const start = input.selectionStart; const end = input.selectionEnd;
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    name.setText(t(show ? "hideKey" : "showKey"));
    toggle.setAttribute("title", t(show ? "hideKey" : "showKey"));
    toggle.setAttribute("aria-pressed", String(show));
    setIcon(toggle, show ? "eye-off" : "eye");
    if (start !== null && end !== null) input.setSelectionRange(start, end);
  });
  // Explicit gesture only: never inspect the clipboard when opening the form.
  const actions = parent.createDiv({ cls: "qa-secret-actions" });
  const paste = actions.createEl("button", { cls: "qa-ms-button qa-secret-paste", text: t("pasteKey"), attr: { type: "button" } });
  const status = actions.createSpan({ cls: "qa-secret-status", attr: { role: "status", "aria-live": "polite" } });
  let revision = 0;
  let pending = false;
  input.addEventListener("input", () => { revision++; status.setText(""); });
  paste.addEventListener("click", async () => {
    if (pending || input.disabled) return;
    const before = input.value;
    const version = revision;
    const current = () => input.isConnected && !input.disabled && revision === version && input.value === before;
    pending = true; paste.disabled = true;
    try {
      const clipboard = input.ownerDocument.defaultView?.navigator.clipboard;
      if (!clipboard?.readText) throw new Error("Clipboard unavailable");
      // Call immediately inside the click handler to retain WebKit user activation.
      const value = (await clipboard.readText()).trim();
      if (!current()) return;
      if (!value) { status.setText(t("clipboardEmpty")); return; }
      if (/\s/.test(value)) { status.setText(t("clipboardInvalid")); return; }
      input.value = value;
      // Update the existing form draft without rebuilding or focusing the secure field.
      const event = input.ownerDocument.createEvent("Event");
      event.initEvent("input", true, false);
      input.dispatchEvent(event);
      status.setText(t("keyPasted"));
    } catch {
      if (current()) status.setText(t("clipboardDenied"));
    } finally {
      pending = false;
      if (paste.isConnected) paste.disabled = input.disabled;
    }
  });
  return input;
}
