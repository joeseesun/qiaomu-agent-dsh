import { setIcon, ToggleComponent } from "obsidian";

/** Shared building blocks for the plugin's settings pages and dialogs (qa-ms-* styles). */

export function iconAction(parent: HTMLElement, icon: string, label: string, cls = ""): HTMLButtonElement {
  const button = parent.createEl("button", { cls: `qa-icon-action ${cls}`, attr: { type: "button", "aria-label": label } });
  setIcon(button.createSpan({ attr: { "aria-hidden": "true" } }), icon);
  return button;
}

/** A quiet outlined button with a Lucide icon and a short visible label. */
export function actionButton(parent: HTMLElement, icon: string, text: string, cls = ""): HTMLButtonElement {
  const button = parent.createEl("button", { cls: `qa-ms-button ${cls}`, attr: { type: "button" } });
  setIcon(button.createSpan({ cls: "qa-ms-button-icon", attr: { "aria-hidden": "true" } }), icon);
  button.createSpan({ text });
  return button;
}

/** Host switch; its accessible name says what "on" means. */
export function hostSwitch(parent: HTMLElement, checked: boolean, label: string, onChange: (value: boolean) => void): ToggleComponent {
  const toggle = new ToggleComponent(parent).setValue(checked).onChange(onChange);
  toggle.toggleEl.addClass("qa-ms-switch");
  const name = parent.createSpan({ cls: "qiaomu-agent__sr-only", text: label });
  name.id = `qa-switch-${crypto.randomUUID()}`;
  toggle.toggleEl.querySelector("input")?.setAttribute("aria-labelledby", name.id);
  return toggle;
}

/** Section title, one-line purpose and actions on the right. */
export function sectionHead(parent: HTMLElement, title: string, description?: string): HTMLElement {
  const head = parent.createDiv({ cls: "qa-ms-head" });
  const text = head.createDiv({ cls: "qa-ms-head-text" });
  text.createEl("h3", { text: title });
  if (description) text.createEl("p", { text: description });
  return head.createDiv({ cls: "qa-ms-head-actions" });
}

export interface NavRowOptions {
  icon: string;
  name: string;
  sub?: string;
  /** The subline names a next step (warning color). */
  attention?: boolean;
  onOpen: () => void;
}

/** A full-width row that opens a detail page; returns the row so callers can add a trailing control. */
export function navRow(list: HTMLElement, options: NavRowOptions): HTMLElement {
  const entry = list.createDiv({ cls: "qa-ms-row" });
  const main = entry.createEl("button", { cls: "qa-ms-row-main", attr: { type: "button" } });
  setIcon(main.createSpan({ cls: "qa-ms-row-icon", attr: { "aria-hidden": "true" } }), options.icon);
  const text = main.createDiv({ cls: "qa-ms-row-text" });
  text.createDiv({ cls: "qa-ms-row-name", text: options.name });
  if (options.sub) text.createDiv({ cls: `qa-ms-row-sub${options.attention ? " is-attention" : ""}`, text: options.sub });
  setIcon(main.createSpan({ cls: "qa-ms-chevron", attr: { "aria-hidden": "true" } }), "chevron-right");
  main.addEventListener("click", options.onOpen);
  return entry;
}

/** A labelled block whose control spans the full width (long text, lists). */
export function wideField(parent: HTMLElement, label: string, hint?: string): HTMLElement {
  const wrapper = parent.createDiv({ cls: "qa-ms-wide" });
  const head = wrapper.createDiv({ cls: "qa-ms-wide-head" });
  head.createDiv({ cls: "qa-ms-wide-label", text: label });
  if (hint) head.createDiv({ cls: "qa-ms-wide-hint", text: hint });
  return wrapper;
}

/** Give a form control the name already shown above it, without a hover tooltip. */
export function labelField(field: HTMLElement, control: HTMLElement): void {
  const label = field.querySelector<HTMLElement>(".qa-ms-wide-label");
  if (!label) return;
  label.id ||= `qa-field-${crypto.randomUUID()}`;
  control.setAttribute("aria-labelledby", label.id);
}

/** A row with a host switch on the right and no detail page. */
export function switchRow(list: HTMLElement, options: Omit<NavRowOptions, "onOpen">, checked: boolean, label: string, onChange: (value: boolean) => void): ToggleComponent {
  const entry = list.createDiv({ cls: "qa-ms-row" });
  const main = entry.createDiv({ cls: "qa-ms-row-main is-static" });
  setIcon(main.createSpan({ cls: "qa-ms-row-icon", attr: { "aria-hidden": "true" } }), options.icon);
  const text = main.createDiv({ cls: "qa-ms-row-text" });
  text.createDiv({ cls: "qa-ms-row-name", text: options.name });
  if (options.sub) text.createDiv({ cls: `qa-ms-row-sub${options.attention ? " is-attention" : ""}`, text: options.sub });
  return hostSwitch(entry.createDiv({ cls: "qa-ms-row-switch" }), checked, label, onChange);
}
