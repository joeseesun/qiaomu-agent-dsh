import { renderPrivateHttpNotice } from "./private-http-notice";
import { hasPrivateHttpConsent } from "../services/network-hosts";
import { accountText as at } from "../i18n/accounts";
import { loginKind, signInAccount, readAccount, signOutAccount } from "../services/provider-auth";
import { magpieAddress, detectMagpie } from "../services/magpie";
import { mobileProviderModal } from "./mobile-provider-modal";
import { providerModels, manualProviderModels, refreshProviderModels, addManualProviderModel, editProviderModel, removeProviderModel } from "../services/provider-models";
import { secretInput } from "./secret-input";
import { connectionText as ct } from "../i18n/connection";
import { connectionError } from "../services/api-transport";
import { Modal, Notice, Platform, setIcon, type App } from "obsidian";
import type QiaomuAgentPlugin from "../main";
import type { ApiConnection, ChatRequest, CliDetection, ModelChoice, ModelOptions, ProviderConfig } from "../types";
import { API_PROVIDERS, apiProtocol, permitsEmptyKey, validateApiUrl, isPrivateHttpUrl, type ProviderGroup } from "../services/api-providers";
import { ApiBackend } from "../services/api-backend";
import { compactTokens, resolveModel } from "../services/model-capabilities";
import { isChatModel, recommendedModels } from "../services/key-detection";
import { agentShown, addProviderConnection, persistProviderChange, persistProviderRemoval, persistProviderModelChange, DEFAULT_VISIBLE_AGENT_IDS, maskKey, providerHost, providerIcon, providerLabel, providerSecretId, upsertProvider } from "../services/model-sources";
import { nativeTransportFor, nativeTransportLabel } from "../services/native-agent-backend";
import { agentIconKey } from "./brand-icon";
import { BRAND_ICONS } from "./brand-icons";
import { actionButton, hostSwitch, iconAction, sectionHead } from "./settings-kit";

function brand(parent: HTMLElement, icon: string | undefined, fallback: string, size = 20): void {
  const span = parent.createSpan({ cls: `qa-brand qa-brand--size-${size}` });
  span.setAttribute("aria-hidden", "true");
  const svg = icon ? BRAND_ICONS[icon] : undefined;
  if (svg) {
    const parsed = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
    if (parsed.localName === "svg" && parsed.namespaceURI === "http://www.w3.org/2000/svg") {
      span.appendChild(document.importNode(parsed, true));
      return;
    }
  }
  span.addClass("qa-brand--generic");
  setIcon(span, fallback);
}



function labeledInput(parent: HTMLElement, label: string, type: string, cls: string, attr: Record<string, string> = {}): HTMLInputElement {
  const wrapper = parent.createEl("label", { cls: "qa-input-label" });
  wrapper.createSpan({ cls: "qiaomu-agent__sr-only", text: label });
  return wrapper.createEl("input", { type, cls, attr });
}

/** A visible field label above its control. */
function field(parent: HTMLElement, label: string, hint?: string): HTMLElement {
  const wrapper = parent.createDiv({ cls: "qa-ms-field" });
  const head = wrapper.createDiv({ cls: "qa-ms-field-head" });
  head.createSpan({ cls: "qa-ms-field-label", text: label });
  if (hint) head.createSpan({ cls: "qa-ms-field-hint", text: hint });
  return wrapper;
}

function labelGroup(group: HTMLElement, label: string): void {
  const id = `qa-group-${crypto.randomUUID()}`;
  group.createSpan({ cls: "qiaomu-agent__sr-only", text: label, attr: { id } });
  group.setAttribute("aria-labelledby", id);
}

/** Modal title with an optional back control in the same row. */
function modalTitle(modal: Modal, text: string, icon?: { key: string | undefined; fallback: string }, back?: () => void): void {
  modal.titleEl.empty();
  modal.titleEl.addClass("qa-modal-title");
  if (back) iconAction(modal.titleEl, "arrow-left", "返回", "qa-modal-back").addEventListener("click", back);
  if (icon) brand(modal.titleEl, icon.key, icon.fallback, 22);
  modal.titleEl.createSpan({ cls: "qa-modal-title-text", text });
}

function listModelsFor(app: App, connection: ApiConnection, key: string, signal?: AbortSignal): Promise<ModelChoice[]> {
  return new ApiBackend(connection, key, "", app).listModels(undefined, signal);
}

async function verifyModel(app: App, connection: ApiConnection, key: string, model: string, signal?: AbortSignal): Promise<void> {
  let text = "";
  await new ApiBackend({ ...connection, model }, key, "", app).send(
    { prompt: "Reply with exactly: OK", systemPrompt: "", cwd: null, model, modelOptions: { maxOutputTokens: 1024 }, permissionMode: "plan", history: [], webSearch: false },
    { onText: (chunk) => { text += chunk; }, onStatus: () => {} },
    signal ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000));
  if (!text.trim()) throw new Error(ct("noText"));
}

/**
 * Model sources on one page: cloud services first, then local agents on desktop.
 * A row opens its details; its switch decides whether it appears in the composer.
 */
export class ProviderSettings {
  private detecting = false;
  private detectionAttempted = false;
  private detectionError = "";
  private showOtherAgents = false;

  constructor(private readonly plugin: QiaomuAgentPlugin, private readonly rerender: () => void) {}

  private get settings() { return this.plugin.settings; }
  private get app() { return this.plugin.app; }
  private secret(provider: ApiConnection): string { return this.app.secretStorage.getSecret(provider.secretId) ?? ""; }

  render(container: HTMLElement): void {
    container.addClass("qa-models");
    this.renderApi(container.createDiv({ cls: "qa-ms-section" }));
    if (Platform.isDesktopApp) this.renderAgents(container.createDiv({ cls: "qa-ms-section" }));
  }

  private renderApi(section: HTMLElement): void {
    const providers = this.settings.providers;
    const actions = sectionHead(section, "模型服务", at("services"));
    const openChooser = () => new ProviderChooserModal(this.app, this.plugin, this.rerender).open();
    if (providers.length) actionButton(actions, "plus", "添加服务商").addEventListener("click", openChooser);
    if (!providers.length) {
      const empty = section.createDiv({ cls: "qa-ms-empty" });
      empty.createDiv({ cls: "qa-ms-empty-title", text: "还没有连接模型服务" });
      empty.createDiv({ cls: "qa-ms-empty-text", text: at("empty") });
      actionButton(empty, "plus", "添加服务商", "is-primary").addEventListener("click", openChooser);
      return;
    }
    const list = section.createDiv({ cls: "qa-ms-list" });
    for (const provider of providers) {
      const ok = provider.provider === "chatgpt" ? Boolean(readAccount(this.secret(provider))?.access) : Boolean(this.secret(provider)) || permitsEmptyKey(provider);
      const count = new Set(provider.enabledModels ?? []).size;
      const sub = !ok ? (provider.provider === "chatgpt" ? at("needsLogin") : "需要 API Key") : count ? `${count} 个模型 · ${providerHost(provider)}` : "尚未启用模型";
      this.row(list, providerIcon(provider), "boxes", providerLabel(provider), sub, !ok || !count,
        () => new ProviderModal(this.app, this.plugin, provider.id, this.rerender).open(), provider.showInPicker !== false,
        async (shown) => { upsertProvider(this.settings, { ...provider, showInPicker: shown }); await this.plugin.saveSettings(); this.rerender(); });
    }
  }

  private renderAgents(section: HTMLElement): void {
    const agents = this.plugin.backendService.getDetections();
    const ready = agents.filter((agent) => agent.callable);
    const popular: readonly string[] = DEFAULT_VISIBLE_AGENT_IDS;
    const main = ready.filter((agent) => popular.includes(agent.id) || agent.id === this.settings.preferredCli)
      .sort((a, b) => popular.indexOf(a.id) - popular.indexOf(b.id));
    const other = ready.filter((agent) => !main.includes(agent));
    const actions = sectionHead(section, "本机 Agent", "已安装的命令行 Agent，使用它们自己的登录与模型。");
    const redetect = actionButton(actions, "refresh-cw", this.detecting ? "检测中…" : "重新检测", this.detecting ? "is-busy" : "");
    redetect.disabled = this.detecting;
    redetect.addEventListener("click", () => void this.detect());
    if (this.detectionError) section.createDiv({ cls: "qa-inline-error", text: `检测失败：${this.detectionError}`, attr: { role: "alert" } });
    if (!ready.length) {
      const empty = section.createDiv({ cls: "qa-ms-empty" });
      empty.createDiv({ cls: "qa-ms-empty-text", text: this.detecting || !this.detectionAttempted && !agents.length ? "正在检测本机 Agent…" : "没有找到可用的 Agent CLI。安装后点“重新检测”。" });
    } else {
      const list = section.createDiv({ cls: "qa-ms-list" });
      for (const agent of main) this.agentRow(list, agent);
      if (other.length) {
        if (this.showOtherAgents) for (const agent of other) this.agentRow(list, agent);
        const more = list.createEl("button", { cls: "qa-ms-more", attr: { type: "button", "aria-expanded": String(this.showOtherAgents) } });
        more.createSpan({ text: this.showOtherAgents ? "收起其他 Agent" : `其他 ${other.length} 个 Agent` });
        setIcon(more.createSpan({ cls: "qa-ms-chevron", attr: { "aria-hidden": "true" } }), this.showOtherAgents ? "chevron-up" : "chevron-down");
        more.addEventListener("click", () => { this.showOtherAgents = !this.showOtherAgents; this.rerender(); });
      }
    }
    const unavailable = agents.filter((agent) => agent.available && !agent.callable);
    if (unavailable.length) section.createDiv({ cls: "qa-ms-note", text: unavailable.map((agent) => agent.note || `${agent.label} 已安装，暂不可调用`).join("；") });
    if (!agents.length && !this.detecting && !this.detectionAttempted) void this.detect();
  }

  private agentRow(list: HTMLElement, agent: CliDetection): void {
    const count = this.settings.agentModelCache[agent.id]?.models.length ?? 0;
    this.row(list, agentIconKey(agent.id), "bot", agent.label, count ? `${count} 个模型` : "使用 Agent 的默认模型", false,
      () => new AgentModal(this.app, this.plugin, agent, this.rerender).open(), agentShown(this.settings, agent.id),
      async (shown) => { this.settings.agentVisibility[agent.id] = shown; this.settings.hiddenAgents = this.settings.hiddenAgents.filter((id) => id !== agent.id); await this.plugin.saveSettings(); this.rerender(); });
  }

  private async detect(): Promise<void> {
    if (this.detecting) return;
    this.detecting = true;
    this.detectionAttempted = true;
    this.detectionError = "";
    try { await this.plugin.refreshIntegrations(); }
    catch (error) { this.detectionError = error instanceof Error ? error.message : String(error); }
    finally { this.detecting = false; this.rerender(); }
  }

  private row(list: HTMLElement, icon: string | undefined, fallback: string, name: string, sub: string, attention: boolean, open: () => void, shown: boolean, onShown: (shown: boolean) => void): void {
    const entry = list.createDiv({ cls: `qa-ms-row${shown ? "" : " is-off"}` });
    const main = entry.createEl("button", { cls: "qa-ms-row-main", attr: { type: "button" } });
    brand(main, icon, fallback);
    const text = main.createDiv({ cls: "qa-ms-row-text" });
    text.createDiv({ cls: "qa-ms-row-name", text: name });
    text.createDiv({ cls: `qa-ms-row-sub${attention ? " is-attention" : ""}`, text: sub });
    setIcon(main.createSpan({ cls: "qa-ms-chevron", attr: { "aria-hidden": "true" } }), "chevron-right");
    main.addEventListener("click", open);
    hostSwitch(entry.createDiv({ cls: "qa-ms-row-switch" }), shown, `在对话中显示 ${name}`, onShown);
  }
}

const GROUPS: Array<[ProviderGroup, string]> = [["global", "海外"], ["cn", "国内"], ["relay", "聚合平台"]];

/** Choose a provider, then sign in or configure its connection. */
export class ProviderChooserModal extends Modal {
  private closed = false;
  private selected = "";
  private key = "";
  private name = "";
  private url = "";
  private protocol: NonNullable<ApiConnection["protocol"]> = "openai-chat";
  private busy = false;
  private error = "";
  private changed = false;
  private loginOperation: AbortController | null = null;
  private allowPrivateHttp = false;
  private drafts = new Map<string, { key: string; url: string; name: string; allowPrivateHttp?: boolean }>();
  constructor(app: App, private readonly plugin: QiaomuAgentPlugin, private readonly onChange: () => void) { super(app); }

  private disposeMobile = () => {};
  override onOpen(): void { this.closed = false; this.modalEl.addClass("qa-provider-chooser-modal"); this.draw(); this.disposeMobile = mobileProviderModal(this.modalEl, this.contentEl); if (!Platform.isMobile) this.contentEl.querySelector<HTMLInputElement>("input")?.focus(); }
  override onClose(): void { this.disposeMobile(); this.closed = true; this.loginOperation?.abort(); this.drafts.clear(); this.busy = false; this.key = ""; this.contentEl.empty(); if (this.changed) this.onChange(); }

  private draw(): void {
    this.contentEl.empty();
    if (this.selected) { this.drawConnection(); return; }
    modalTitle(this, "添加服务商");
    const search = labeledInput(this.contentEl, "搜索服务商", "search", "qa-provider-search", { placeholder: "搜索服务商", autocomplete: "off" });
    const scroller = this.contentEl.createDiv({ cls: "qa-provider-choices" });
    const items: Array<{ text: string; button: HTMLButtonElement; group: HTMLElement }> = [];
    const choose = (id: string) => {
      this.selected = id; this.error = "";
      const draft = this.drafts.get(id); this.key = draft?.key ?? ""; this.url = draft?.url ?? API_PROVIDERS[id]?.baseUrl ?? ""; this.name = draft?.name ?? "";
      this.allowPrivateHttp = draft?.allowPrivateHttp ?? false;
      this.draw();
    };
    const group = (title: string) => {
      const wrapper = scroller.createDiv({ cls: "qa-provider-group" });
      wrapper.createDiv({ cls: "qa-provider-group-title", text: title });
      return { wrapper, grid: wrapper.createDiv({ cls: "qa-provider-grid" }) };
    };
    const choice = (target: { wrapper: HTMLElement; grid: HTMLElement }, id: string, label: string, icon: string | undefined, fallback: string, keywords = "") => {
      const button = target.grid.createEl("button", { cls: "qa-provider-choice", attr: { type: "button" } });
      brand(button, icon, fallback, 18);
      button.createSpan({ text: label });
      button.addEventListener("click", () => choose(id));
      items.push({ text: `${label} ${id} ${keywords}`.toLowerCase(), button, group: target.wrapper });
    };
    const accounts = group(at("accounts"));
    for (const id of ["chatgpt", "openrouter", "tokendance"]) {
      const preset = API_PROVIDERS[id]!; choice(accounts, id, preset.label, preset.icon, "log-in");
    }
    const subscriptions = group("Claude · Codex · Copilot · Qoder");
    choice(subscriptions, "magpie", "Magpie", undefined, "network", "订阅 subscription Claude Codex Copilot Qoder ZCode Kimi Gemini Antigravity MiMo MiniMax Code WorkBuddy Trae");
    for (const [groupId, title] of [...GROUPS, ["plan", at("plans")] as [ProviderGroup, string]]) {
      const presets = Object.entries(API_PROVIDERS).filter(([id, preset]) => id !== "custom" && !preset.local && preset.group === groupId && !loginKind(id));
      if (!presets.length) continue;
      const target = group(title);
      for (const [id, preset] of presets) choice(target, id, preset.label, preset.icon, "boxes");
    }
    const rest = Object.entries(API_PROVIDERS).filter(([id, preset]) => id !== "custom" && !preset.local && !loginKind(id) && preset.group !== "plan" && !GROUPS.some(([groupId]) => groupId === preset.group));
    const extra = group("本地与自定义");
    for (const [id, preset] of rest) choice(extra, id, preset.label, preset.icon, "boxes");
    if (Platform.isDesktopApp) for (const id of ["ollama", "lmstudio"]) choice(extra, id, API_PROVIDERS[id]!.label, API_PROVIDERS[id]!.icon, "boxes", "local 本地");
    choice(extra, "custom", "自定义接口", undefined, "settings-2", "custom openai anthropic 中转");
    const empty = scroller.createDiv({ cls: "qa-ms-empty-text qa-provider-none", text: "没有匹配的服务商，可以用“自定义接口”连接" });
    const filter = () => {
      const q = search.value.trim().toLowerCase();
      for (const item of items) item.button.hidden = Boolean(q) && !item.text.includes(q);
      for (const wrapper of new Set(items.map((item) => item.group))) wrapper.hidden = items.every((item) => item.group !== wrapper || item.button.hidden);
      empty.hidden = items.some((item) => !item.button.hidden);
    };
    search.addEventListener("input", filter);
    search.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { const first = items.find((item) => !item.button.hidden); if (first) { event.preventDefault(); first.button.click(); } }
      if (event.key === "ArrowDown") { const first = items.find((item) => !item.button.hidden); if (first) { event.preventDefault(); first.button.focus(); } }
    });
    filter();
    if (!Platform.isMobile) search.focus();
  }

  private drawConnection(): void {
    const preset = API_PROVIDERS[this.selected] ?? API_PROVIDERS.custom!;
    modalTitle(this, this.selected === "custom" ? "自定义接口" : preset.label, { key: preset.icon, fallback: this.selected === "custom" ? "settings-2" : "boxes" },
      () => { if (this.busy && !this.loginOperation) return;
        this.loginOperation?.abort(); this.loginOperation = null; this.busy = false;
        this.drafts.set(this.selected, { key: this.key, url: this.url, name: this.name, allowPrivateHttp: this.allowPrivateHttp });
        this.selected = ""; this.error = ""; this.draw(); });
    const back = this.titleEl.querySelector<HTMLButtonElement>(".qa-modal-back");
    if (back) back.disabled = this.busy && !this.loginOperation;
    const form = this.contentEl.createDiv({ cls: "qa-ms-form" });
    if (this.selected === "custom") {
      const name = labeledInput(field(form, "显示名称"), "显示名称", "text", "qa-ms-input", { placeholder: "例如：我的中转站" });
      name.value = this.name;
      name.addEventListener("input", () => { this.name = name.value.trim(); });
      const types = field(form, "接口类型").createDiv({ cls: "qa-segments", attr: { role: "radiogroup" } });
      labelGroup(types, "接口类型");
      for (const [value, label] of [["openai-chat", "OpenAI 兼容"], ["openai-responses", ct("responses")], ["anthropic", "Anthropic 兼容"]] as const) {
        const option = types.createEl("button", { text: label, attr: { type: "button", role: "radio", "aria-checked": String(this.protocol === value), tabindex: this.protocol === value ? "0" : "-1" } });
        option.addEventListener("keydown", (event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const choices = [...types.querySelectorAll<HTMLButtonElement>("[role=radio]")];
          const index = choices.indexOf(option);
          const target = event.key === "Home" ? 0 : event.key === "End" ? choices.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + choices.length) % choices.length;
          choices[target]?.click();
        });
        option.addEventListener("click", () => { this.protocol = value; this.error = ""; this.draw(); this.contentEl.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus(); });
      }
      const urlField = field(form, "接口地址");
      const url = labeledInput(urlField, "接口地址", "url", "qa-ms-input is-mono", { placeholder: this.protocol === "anthropic" ? "https://api.example.com" : "https://api.example.com/v1" });
      url.value = this.url;
      const updateNotice = renderPrivateHttpNotice(form, () => this.url, () => this.allowPrivateHttp, (val) => { this.allowPrivateHttp = val; }, () => {
        if (this.error === ct("privateHttpRequired")) { this.error = ""; form.querySelector(".qa-inline-error")?.remove(); }
      });
      url.addEventListener("input", () => {
        const prev = this.url;
        this.url = url.value.trim();
        if (prev !== this.url) {
          this.allowPrivateHttp = false;
        }
        updateNotice();
      });
    }
    const kind = loginKind(this.selected);
    if (kind) {
      form.createDiv({ cls: "qa-ms-note", text: at(Platform.isDesktopApp ? kind === "chatgpt" ? "chatgptHint" : "browser" : "desktop") });
      const login = actionButton(form, "log-in", this.busy ? at("waiting") : kind === "chatgpt" ? "Continue with ChatGPT" : at("login"), "is-primary");
      login.disabled = this.busy || !Platform.isDesktopApp;
      login.addEventListener("click", () => void this.login());
      if (this.busy && this.loginOperation) {
        const cancel = actionButton(form, "x", at("cancel")); cancel.dataset.cancelLogin = "true";
        cancel.addEventListener("click", () => { this.loginOperation?.abort(); this.loginOperation = null; this.busy = false; this.draw(); });
      }
      if (kind !== "chatgpt") form.createDiv({ cls: "qa-ms-note", text: at("keyInstead") });
    }
    if (this.selected === "magpie") {
      form.createDiv({ cls: "qa-ms-note", text: at("magpie") });
      const url = labeledInput(field(form, at("endpoint")), at("endpoint"), "url", "qa-ms-input is-mono");
      url.value = this.url || preset.baseUrl;
      url.addEventListener("input", () => { this.url = url.value.trim(); });
      const detect = actionButton(form, "search", at("detect"));
      detect.addEventListener("click", () => void this.detectGateway(url));
      form.createEl("a", { text: at("gatewayLink"), href: "https://usemagpie.ai/docs/start", attr: { target: "_blank", rel: "noopener noreferrer" } });
    }
    let keyInput: HTMLInputElement | null = null;
    if ((!preset.local || this.selected === "magpie") && kind !== "chatgpt") {
      const keyField = field(form, this.selected === "magpie" ? at("gatewayKey") : "API Key");
      keyInput = secretInput(keyField, "API Key", "粘贴 API Key");
      keyInput.value = this.key;
      keyInput.addEventListener("input", () => { this.key = keyInput!.value.trim(); });
      keyInput.addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); void this.connect(); } });
      if (preset.website) this.keyLink(keyField, preset.website);
    } else if (preset.local) {
      form.createDiv({ cls: "qa-ms-note", text: at("localService") });
    }
    if (this.error) form.createDiv({ cls: "qa-inline-error", text: this.error, attr: { role: "alert" } });
    if (kind === "chatgpt") return;
    const footer = this.contentEl.createDiv({ cls: "qa-ms-footer" });
    const note = footer.createDiv({ cls: "qa-ms-footer-note" });
    if (!preset.local) {
      setIcon(note.createSpan({ cls: "qa-inline-icon", attr: { "aria-hidden": "true" } }), "lock");
      note.createSpan({ text: ct("secretNote") });
    }
    const connect = footer.createEl("button", { cls: "mod-cta", text: this.busy ? ct("saving") : ct("saveManage"), attr: { type: "button" } });
    connect.disabled = this.busy;
    connect.addEventListener("click", () => void this.connect());
    if (this.busy) form.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input, button:not([data-cancel-login])').forEach((control) => { control.disabled = true; });
  }

  private async login(): Promise<void> {
    const kind = loginKind(this.selected); if (!kind || this.busy) return;
    const op = new AbortController(); this.loginOperation = op; this.busy = true; this.error = ""; this.draw();
    try {
      const result = await signInAccount(kind, this.app.secretStorage, url => window.open(url, "_blank", "noopener,noreferrer"), op.signal);
      if (this.closed || op.signal.aborted || this.loginOperation !== op) return;
      this.key = result.secret; this.name = result.label ? `ChatGPT · ${result.label}` : "";
      this.loginOperation = null; this.busy = false; await this.connect();
    } catch (error) { if (!op.signal.aborted && !this.closed && this.loginOperation === op) this.error = connectionError(error); }
    finally { if (this.loginOperation === op) { this.loginOperation = null; this.busy = false; if (!this.closed) this.draw(); } }
  }

  private async detectGateway(input: HTMLInputElement): Promise<void> {
    const op = new AbortController(); this.loginOperation?.abort(); this.loginOperation = op;
    try {
      if (!input.value || input.value === API_PROVIDERS.magpie!.baseUrl) {
        const address = await magpieAddress();
        if (this.closed || op.signal.aborted || this.loginOperation !== op) return;
        input.value = address;
      }
      this.url = input.value;
      await detectMagpie(this.url, this.key, op.signal);
      if (!this.closed && this.loginOperation === op) new Notice(at("detected"));
    } catch (error) { if (!this.closed && !op.signal.aborted && this.loginOperation === op) { this.error = connectionError(error); this.draw(); } }
    finally { if (this.loginOperation === op) this.loginOperation = null; }
  }

  private keyLink(parent: HTMLElement, href: string): void {
    const link = parent.createEl("a", { cls: "qa-ms-link", text: "在服务商后台获取 API Key", href, attr: { rel: "noopener noreferrer", target: "_blank" } });
    setIcon(link.createSpan({ attr: { "aria-hidden": "true" } }), "arrow-up-right");
  }

  private async connect(): Promise<void> {
    if (this.busy) return;
    const preset = API_PROVIDERS[this.selected] ?? API_PROVIDERS.custom!;
    if (!preset.local && !this.key) { this.error = "请输入 API Key"; this.draw(); this.contentEl.querySelector<HTMLElement>(Platform.isMobile ? ".qa-secret-paste" : ".qa-secret-input input")?.focus(); return; }
    let endpoint: { baseUrl?: string; protocol?: ApiConnection["protocol"]; name?: string; privateHttpApprovedUrl?: string } = this.name ? { name: this.name } : {};
    if (this.selected === "custom") {
      if (isPrivateHttpUrl(this.url) && !this.allowPrivateHttp) {
        this.error = ct("privateHttpRequired");
        this.draw();
        return;
      }
      try { endpoint = { baseUrl: validateApiUrl(this.url, this.allowPrivateHttp), protocol: this.protocol, name: this.name || undefined, privateHttpApprovedUrl: isPrivateHttpUrl(this.url) ? this.url : undefined }; }
      catch (error) { this.error = error instanceof Error ? error.message : String(error); this.draw(); return; }
    }
    if (this.selected === "magpie") {
      try { endpoint.baseUrl = validateApiUrl(this.url || preset.baseUrl); }
      catch (error) { this.error = connectionError(error); this.draw(); return; }
      if (!this.key && !permitsEmptyKey({ ...this.plugin.settings.api, provider: "magpie", baseUrl: endpoint.baseUrl })) { this.error = ct("missingKey"); this.draw(); return; }
    }
    this.busy = true; this.error = ""; this.draw();
    let added: ProviderConfig | undefined;
    try {
      const provider = await persistProviderChange(this.plugin.settings, () => added = addProviderConnection(this.plugin.settings, this.selected, this.key,
        (id, value) => this.app.secretStorage.setSecret(id, value), endpoint), () => this.plugin.saveSettings());
      this.changed = true;
      if (this.closed) { this.onChange(); return; }
      new Notice(`${ct("saved")} · ${providerLabel(provider)}`);
      this.close();
      new ProviderModal(this.app, this.plugin, provider.id, this.onChange).open();
    } catch (error) {
      if (added) this.app.secretStorage.setSecret(added.secretId, "");
      if (this.closed) return;
      this.error = connectionError(error);
      this.busy = false; this.draw();
    }
  }
}

/** Confirmation names the exact model; failure stays open and permits a safe retry. */
class ModelRemovalModal extends Modal {
  private busy = false;
  constructor(app: App, private readonly label: string, private readonly modelId: string, private readonly isDefault: boolean, private readonly removeModel: () => Promise<void>) { super(app); }

  override onOpen(): void {
    this.modalEl.addClass("qa-provider-modal", "qa-model-removal-modal");
    modalTitle(this, ct("deleteModel"));
    this.contentEl.createEl("p", { text: `${ct("deleteModelPrompt")} ${this.label}`, cls: "qa-ms-removal-name" });
    if (this.label !== this.modelId) this.contentEl.createEl("p", { text: this.modelId, cls: "qa-ms-note qa-ms-removal-name" });
    this.contentEl.createEl("p", { text: ct("deleteModelHint"), cls: "qa-ms-note" });
    if (this.isDefault) this.contentEl.createEl("p", { text: ct("deleteModelDefault"), cls: "qa-ms-note" });
    const error = this.contentEl.createDiv({ cls: "qa-inline-error", attr: { role: "alert" } });
    const actions = this.contentEl.createDiv({ cls: "qa-ms-form-actions" });
    const cancel = actions.createEl("button", { cls: "qa-ms-button", text: ct("cancel"), attr: { type: "button" } });
    cancel.addEventListener("click", () => { if (!this.busy) this.close(); });
    const confirm = actions.createEl("button", { cls: "qa-ms-button is-danger-strong", text: ct("deleteModelConfirm"), attr: { type: "button" } });
    confirm.addEventListener("click", async () => {
      if (this.busy) return;
      this.busy = true; cancel.disabled = true; confirm.disabled = true; error.empty();
      try { await this.removeModel(); this.close(); }
      catch (failure) { error.setText(connectionError(failure)); }
      finally { this.busy = false; cancel.disabled = false; confirm.disabled = false; }
    });
    cancel.focus();
  }

  override onClose(): void { this.contentEl.empty(); }
}

/** One provider on one page, with explicit identity saves and immediate parameter updates. */
export class ProviderModal extends Modal {
  private modelIdDraft = "";
  private modelNameDraft = "";
  private modelError = "";
  private operation: AbortController | null = null;
  private closed = false;
  private query = "";
  private detailModel = "";
  private modelEditDraft: { id: string; name: string } | null = null;
  private keyDraft = "";
  private endpointDraft = "";
  private protocolDraft: ApiConnection["protocol"] = "openai-chat";
  private addingModel = false;
  private confirmRemove = false;
  private accountOperation: AbortController | null = null;
  private busy = "";
  private error = "";
  private allowPrivateHttp = false;

  constructor(app: App, private readonly plugin: QiaomuAgentPlugin, private readonly id: string, private readonly onChange: () => void) { super(app); }

  private get provider(): ProviderConfig | undefined { return this.plugin.settings.providers.find((item) => item.id === this.id); }
  private secret(provider: ProviderConfig): string { return this.app.secretStorage.getSecret(provider.secretId) ?? ""; }

  private disposeMobile = () => {};
  override onOpen(): void {
    this.closed = false;
    this.modalEl.addClass("qa-provider-modal");
    const provider = this.provider;
    if (provider) {
      this.endpointDraft = provider.baseUrl;
      this.protocolDraft = apiProtocol(provider);
      this.allowPrivateHttp = hasPrivateHttpConsent(provider);
    }
    this.draw();
    this.disposeMobile = mobileProviderModal(this.modalEl, this.contentEl);
  }
  override onClose(): void { this.disposeMobile(); this.closed = true; this.accountOperation?.abort(); this.operation?.abort(); this.keyDraft = ""; this.contentEl.empty(); this.onChange(); }

  private async save(provider: ProviderConfig): Promise<void> {
    await persistProviderChange(this.plugin.settings, () => { upsertProvider(this.plugin.settings, provider); return provider; }, () => this.plugin.saveSettings());
  }

  private draw(): void {
    const provider = this.provider;
    const scroll = this.contentEl.scrollTop;
    this.contentEl.empty();
    if (!provider) { this.close(); return; }
    if (this.detailModel) { this.drawModelPage(provider); return; }
    modalTitle(this, providerLabel(provider), { key: providerIcon(provider), fallback: "boxes" });
    this.drawConnection(provider);
    this.drawModels(provider);
    const footer = this.contentEl.createDiv({ cls: "qa-ms-footer is-danger-zone" });
    footer.createDiv({ cls: "qa-ms-footer-note", text: this.confirmRemove ? "会删除这个服务商和它的密钥，且不能撤销。" : "" });
    if (this.confirmRemove) footer.createEl("button", { cls: "qa-ms-button", text: "取消", attr: { type: "button" } }).addEventListener("click", () => { this.confirmRemove = false; this.draw(); });
    const remove = footer.createEl("button", { cls: `qa-ms-button ${this.confirmRemove ? "is-danger-strong" : "is-danger"}`, text: this.confirmRemove ? "确认移除" : "移除服务商", attr: { type: "button" } });
    remove.disabled = Boolean(this.busy);
    remove.addEventListener("click", async () => {
      if (!this.confirmRemove) { this.confirmRemove = true; this.draw(); return; }
      this.busy = "remove"; this.draw();
      try {
        await persistProviderRemoval(this.plugin.settings, provider.id, () => this.plugin.saveSettings());
        if (provider.provider === "chatgpt" && !await signOutAccount(provider.secretId, this.app.secretStorage)) new Notice(at("revokeFailed"));
        this.app.secretStorage.setSecret(provider.secretId, "");
        this.close();
      } catch (error) { this.error = connectionError(error); }
      finally { this.busy = ""; if (!this.closed) this.draw(); }
    });
    this.contentEl.scrollTop = scroll;
  }

  private drawConnection(provider: ProviderConfig): void {
    const section = this.contentEl.createDiv({ cls: "qa-ms-section" });
    sectionHead(section, "连接");
    const preset = API_PROVIDERS[provider.provider] ?? API_PROVIDERS.custom!;
    const currentKey = this.secret(provider);
    if (loginKind(provider.provider)) this.drawAccount(section, provider);
    if (provider.provider === "chatgpt") return;
    const form = section.createDiv({ cls: "qa-ms-form" });
    let save!: HTMLButtonElement;
    const dirty = () => Boolean(this.keyDraft) || this.endpointDraft.trim() !== provider.baseUrl || this.protocolDraft !== apiProtocol(provider) || (isPrivateHttpUrl(this.endpointDraft) && this.allowPrivateHttp !== hasPrivateHttpConsent(provider));
    const refresh = () => { save.disabled = Boolean(this.busy) || !dirty(); };
    if (!preset.local || provider.provider === "magpie") {
      const keyField = field(form, provider.provider === "magpie" ? at("gatewayKey") : "API Key", currentKey ? `当前 ${maskKey(currentKey)}` : "未填写");
      const key = secretInput(keyField, "API Key", currentKey ? "粘贴新的 Key 以替换" : "粘贴 API Key");
      key.value = this.keyDraft;
      key.addEventListener("input", () => { this.keyDraft = key.value.trim(); refresh(); });
      if (preset.website) {
        const link = keyField.createEl("a", { cls: "qa-ms-link", text: "在服务商后台获取 API Key", href: preset.website, attr: { rel: "noopener noreferrer", target: "_blank" } });
        setIcon(link.createSpan({ attr: { "aria-hidden": "true" } }), "arrow-up-right");
      }
    }
    const endpointField = field(form, "接口地址");
    const endpoint = labeledInput(endpointField, "接口地址", "url", "qa-ms-input is-mono");
    endpoint.value = this.endpointDraft;
    const updateNotice = renderPrivateHttpNotice(form, () => this.endpointDraft, () => this.allowPrivateHttp, (val) => { this.allowPrivateHttp = val; refresh(); }, () => {
      if (this.error === ct("privateHttpRequired")) { this.error = ""; form.querySelector(".qa-inline-error")?.remove(); }
    });
    endpoint.addEventListener("input", () => {
      const prev = this.endpointDraft;
      this.endpointDraft = endpoint.value.trim();
      if (prev !== this.endpointDraft) {
        this.allowPrivateHttp = false;
      }
      updateNotice();
      refresh();
    });
    if (provider.provider === "custom") {
      const types = field(form, "接口类型").createDiv({ cls: "qa-segments", attr: { role: "radiogroup" } });
      labelGroup(types, "接口类型");
      for (const [value, label] of [["openai-chat", "OpenAI 兼容"], ["openai-responses", ct("responses")], ["anthropic", "Anthropic 兼容"]] as const) {
        const option = types.createEl("button", { text: label, attr: { type: "button", role: "radio", "aria-checked": String(this.protocolDraft === value), tabindex: this.protocolDraft === value ? "0" : "-1" } });
        option.addEventListener("keydown", (event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const choices = [...types.querySelectorAll<HTMLButtonElement>("[role=radio]")];
          const index = choices.indexOf(option);
          const target = event.key === "Home" ? 0 : event.key === "End" ? choices.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + choices.length) % choices.length;
          choices[target]?.click();
        });
        option.addEventListener("click", () => { this.protocolDraft = value; this.error = ""; this.draw(); this.contentEl.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus(); });
      }
    }
    if (this.error) form.createDiv({ cls: "qa-inline-error", text: this.error, attr: { role: "alert" } });
    const actions = form.createDiv({ cls: "qa-ms-form-actions" });
    save = actions.createEl("button", { cls: "qa-ms-button", text: this.busy === "connection" ? ct("saving") : ct("readSave"), attr: { type: "button" } });
    save.addEventListener("click", () => void this.saveConnection(provider));
    refresh();
    if (this.busy) form.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input, button").forEach((control) => { control.disabled = true; });
  }

  private drawAccount(section: HTMLElement, provider: ProviderConfig): void {
    const kind = loginKind(provider.provider)!;
    const creds = readAccount(this.secret(provider));
    if (kind === "chatgpt") section.createDiv({ cls: "qa-ms-note", text: creds?.access ? `${at("accountReady")} · ${creds.email || "ChatGPT"}` : at("needsLogin") });
    const button = actionButton(section, "log-in", this.busy === "login" ? at("waiting") : at("again"));
    button.disabled = Boolean(this.busy) || !Platform.isDesktopApp;
    button.addEventListener("click", async () => {
      const op = new AbortController(); this.accountOperation = op; this.busy = "login"; this.error = ""; this.draw();
      const before = this.secret(provider);
      try {
        const result = await signInAccount(kind, this.app.secretStorage, url => window.open(url, "_blank", "noopener,noreferrer"), op.signal, creds ?? undefined);
        if (this.closed || op.signal.aborted || !this.provider || this.secret(provider) !== before) return;
        this.app.secretStorage.setSecret(provider.secretId, result.secret);
        new Notice(at("accountReady"));
      } catch (error) { if (!op.signal.aborted) this.error = connectionError(error); }
      finally { this.busy = ""; this.accountOperation = null; if (!this.closed) this.draw(); }
    });
    if (this.busy === "login") actionButton(section, "x", at("cancel")).addEventListener("click", () => this.accountOperation?.abort());
    if (kind === "chatgpt" && creds?.access) {
      const out = actionButton(section, "log-out", at("signout")); out.disabled = Boolean(this.busy);
      out.addEventListener("click", async () => {
        this.busy = "logout"; this.draw();
        try { if (!await signOutAccount(provider.secretId, this.app.secretStorage)) new Notice(at("revokeFailed")); }
        catch (error) { this.error = connectionError(error); }
        finally { this.busy = ""; if (!this.closed) this.draw(); }
      });
    }
    if (this.error) section.createDiv({ cls: "qa-inline-error", text: this.error, attr: { role: "alert" } });
  }

  private async saveConnection(provider: ProviderConfig): Promise<void> {
    if (this.busy) return;
    if (isPrivateHttpUrl(this.endpointDraft) && !this.allowPrivateHttp) {
      this.error = ct("privateHttpRequired");
      this.draw();
      return;
    }
    let endpoint: string;
    try { endpoint = validateApiUrl(this.endpointDraft, this.allowPrivateHttp); }
    catch (error) { this.error = error instanceof Error ? error.message : "接口地址无效"; this.draw(); return; }
    const oldKey = this.secret(provider);
    const changedEndpoint = endpoint !== provider.baseUrl;
    const changedIdentity = changedEndpoint || this.protocolDraft !== apiProtocol(provider);
    const key = this.keyDraft || (!changedEndpoint ? oldKey : "");
    if (!key && !permitsEmptyKey({ ...provider, baseUrl: endpoint })) {
      this.error = changedEndpoint ? "修改接口地址后，请填写新地址的 API Key" : "请填写 API Key";
      this.draw(); return;
    }
    const candidate = { ...provider, baseUrl: endpoint, protocol: this.protocolDraft, privateHttpApprovedUrl: isPrivateHttpUrl(endpoint) ? endpoint : undefined };
    this.busy = "connection"; this.error = ""; this.draw();
    const nextSecretId = this.keyDraft || changedEndpoint ? providerSecretId(provider.id) : provider.secretId;
    let saved = false;
    try {
      if (nextSecretId !== provider.secretId) this.app.secretStorage.setSecret(nextSecretId, key);
      const next = changedIdentity ? refreshProviderModels(candidate, []) : candidate;
      await this.save({ ...next, secretId: nextSecretId, ...(changedIdentity ? { fetchedAt: undefined } : {}) });
      saved = true;
      if (nextSecretId !== provider.secretId) this.app.secretStorage.setSecret(provider.secretId, "");
      this.keyDraft = "";
      this.endpointDraft = endpoint;
      new Notice(ct("saved"));
    } catch (error) {
      if (!saved && nextSecretId !== provider.secretId) this.app.secretStorage.setSecret(nextSecretId, "");
      this.error = connectionError(error);
    }
    finally { this.busy = ""; if (!this.closed) this.draw(); }
  }

  private drawModels(provider: ProviderConfig): void {
    const section = this.contentEl.createDiv({ cls: "qa-ms-section" });
    const all = providerModels(provider);
    const enabled = new Set(provider.enabledModels ?? []);
    const recommended = new Set(recommendedModels(provider.provider, all, 3, { pad: false }));
    const key = this.secret(provider);
    const total = new Set([...all.map((model) => model.id), ...enabled]).size;
    const actions = sectionHead(section, "模型", ct("modelHelp"));
    const refresh = actionButton(actions, "refresh-cw", this.busy === "models" ? "刷新中…" : ct("getModels"), this.busy === "models" ? "is-busy" : "");
    refresh.disabled = Boolean(this.busy);
    refresh.addEventListener("click", async () => {
      if (this.busy) return;
      const operation = new AbortController(); this.operation = operation;
      this.busy = "models"; this.modelError = ""; this.draw();
      try {
        const models = await listModelsFor(this.app, provider, key, operation.signal);
        if (this.closed || !this.provider) return;
        await this.save(refreshProviderModels(this.provider, models));
        new Notice(`已获取 ${models.length} 个模型`);
      } catch (error) { if (!this.closed) this.modelError = connectionError(error); }
      this.busy = ""; if (!this.closed) this.draw();
    });
    const add = actionButton(actions, "plus", ct("addManual"), "is-quiet");
    add.disabled = Boolean(this.busy);
    add.addEventListener("click", () => { this.addingModel = true; this.draw(); this.contentEl.querySelector<HTMLInputElement>(".qa-ms-add input")?.focus(); });
    const defaultModel = provider.model || provider.enabledModels?.[0];
    const test = actionButton(actions, "flask-conical", this.busy === "test" ? "测试中…" : "测试", this.busy === "test" ? "is-busy" : "");
    test.disabled = Boolean(this.busy) || (provider.provider === "chatgpt" ? !readAccount(key)?.access : !key && !permitsEmptyKey(provider)) || !defaultModel;
    test.addEventListener("click", () => void this.testModel(provider, key));

    if (this.modelError) section.createDiv({ cls: "qa-inline-error", text: this.modelError, attr: { role: "alert" } });
    const search = total > 8 ? labeledInput(section, "搜索模型", "search", "qa-ms-input qa-ms-search", { placeholder: `搜索 ${total} 个模型` }) : null;
    if (search) search.value = this.query;
    const list = section.createDiv({ cls: "qa-ms-list qa-ms-models" });
    const ids = [...all.map((model) => model.id), ...[...enabled].filter((id) => !all.some((model) => model.id === id))];
    // Enabled first, then recommended, then chat models, then speech/image/embedding models last.
    const rank = (id: string) => enabled.has(id) ? 0 : recommended.has(id) ? 1 : isChatModel(id) ? 2 : 3;
    const sorted = [...ids].sort((a, b) => rank(a) - rank(b));
    const drawList = () => {
      list.empty();
      const q = this.query.trim().toLowerCase();
      const shown = sorted.filter((id) => !q || id.toLowerCase().includes(q) || (all.find((m) => m.id === id)?.name ?? "").toLowerCase().includes(q));
      let lastGroup = -1;
      for (const id of shown.slice(0, 200)) {
        const group = enabled.has(id) ? 0 : isChatModel(id) ? 1 : 2;
        if (group !== lastGroup && !q) list.createDiv({ cls: "qa-ms-list-label", text: ["已启用", "可启用", "非对话模型（语音、图像、向量等）"][group] });
        lastGroup = group;
        this.modelRow(list, provider, id, all.find((item) => item.id === id), enabled, ids, recommended.has(id));
      }
      if (shown.length > 200) list.createDiv({ cls: "qa-ms-list-empty", text: `还有 ${shown.length - 200} 个，请搜索` });
      if (!shown.length) list.createDiv({ cls: "qa-ms-list-empty", text: q ? "没有匹配的模型" : ct("modelEmpty") });
    };
    search?.addEventListener("input", () => { this.query = search.value; drawList(); });
    drawList();

    if (!this.addingModel) return;
    const row = section.createDiv({ cls: "qa-ms-add qa-ms-add-model" });
    const input = labeledInput(row, "模型 ID", "text", "qa-ms-input is-mono", { placeholder: "例如 gpt-5.2", autocomplete: "off", spellcheck: "false" });
    input.value = this.modelIdDraft;
    input.addEventListener("input", () => { this.modelIdDraft = input.value; });
    const displayName = labeledInput(row, ct("displayName"), "text", "qa-ms-input", { placeholder: ct("displayName") });
    displayName.value = this.modelNameDraft;
    displayName.addEventListener("input", () => { this.modelNameDraft = displayName.value; });
    const error = section.createDiv({ cls: "qa-inline-error", attr: { role: "alert" } });
    const submit = async () => {
      if (this.busy) return;
      const latest = this.provider;
      if (!latest) return;
      try {
        const next = addManualProviderModel(latest, input.value, displayName.value);
        this.busy = "add-model";
        await this.save(next);
        this.addingModel = false; this.modelIdDraft = ""; this.modelNameDraft = "";
        new Notice(ct("modelAdded"));
      } catch (failure) { error.setText(connectionError(failure)); }
      finally { this.busy = ""; if (!this.addingModel && !this.closed) this.draw(); }
    };
    row.createEl("button", { cls: "qa-ms-button", text: "添加", attr: { type: "button" } }).addEventListener("click", () => void submit());
    row.createEl("button", { cls: "qa-ms-button is-quiet", text: "取消", attr: { type: "button" } }).addEventListener("click", () => { this.addingModel = false; this.modelIdDraft = ""; this.modelNameDraft = ""; this.draw(); });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); void submit(); }
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); this.addingModel = false; this.draw(); }
    });
  }

  private modelRow(list: HTMLElement, provider: ProviderConfig, id: string, model: ModelChoice | undefined, enabled: Set<string>, ids: string[], recommended: boolean): void {
    const on = enabled.has(id);
    const label = model?.name && model.name !== id ? model.name : id;
    const row = list.createDiv({ cls: `qa-ms-model${on ? " is-on" : ""}` });
    row.dataset.modelId = id;
    const text = row.createDiv({ cls: "qa-ms-row-text" });
    const name = text.createDiv({ cls: "qa-ms-row-name" });
    name.createSpan({ cls: "qa-ms-model-name", text: label });
    if (provider.model === id) name.createSpan({ cls: "qa-pill is-strong", text: "默认" });
    else if (recommended && !on) name.createSpan({ cls: "qa-pill", text: "推荐" });
    const capabilities = resolveModel(provider, id);
    const meta = [label !== id ? id : "", manualProviderModels(provider).some((item) => item.id === id) ? ct("manualEntry") : "", capabilities.contextWindow ? `${compactTokens(capabilities.contextWindow)} 上下文` : "", capabilities.vision ? "图片" : "", capabilities.thinking ? "思考" : ""].filter(Boolean).join(" · ");
    if (meta) text.createDiv({ cls: "qa-ms-row-sub", text: meta });
    const tools = row.createDiv({ cls: "qa-ms-model-tools" });
    if (on && provider.model !== id) {
      const makeDefault = tools.createEl("button", { cls: "qa-ms-text-button", text: "设为默认", attr: { type: "button" } });
      makeDefault.disabled = Boolean(this.busy);
      makeDefault.addEventListener("click", () => void this.updateModel({ ...provider, model: id }));
    }
    const check = iconAction(tools, "flask-conical", `${label} · 测试`);
    check.disabled = Boolean(this.busy);
    check.addEventListener("click", () => void this.testModel({ ...provider, model: id }, this.secret(provider)));
    const edit = iconAction(tools, "pencil", `${ct("editModel")} · ${label}`, "qa-model-edit");
    edit.disabled = Boolean(this.busy);
    edit.addEventListener("click", () => {
      this.detailModel = id; this.modelEditDraft = { id, name: model?.name ?? id }; this.modelError = "";
      this.draw();
      if (!Platform.isMobile) this.contentEl.querySelector<HTMLInputElement>(".qa-ms-model-identity input")?.focus();
    });
    const remove = iconAction(tools, "trash-2", `${ct("deleteModel")} · ${label}`, "qa-model-delete");
    remove.disabled = Boolean(this.busy);
    remove.addEventListener("click", () => {
      new ModelRemovalModal(this.app, label, id, provider.model === id, async () => {
        if (this.busy || this.closed) throw new Error(ct("cancelled"));
        const latest = this.provider;
        if (!latest) throw new Error(ct("modelMissing"));
        this.busy = "delete-model";
        this.draw();
        try {
          await persistProviderModelChange(this.plugin.settings, removeProviderModel(latest, id), id, undefined, () => this.plugin.saveSettings());
          new Notice(ct("modelDeleted"));
        } finally {
          this.busy = "";
          if (!this.closed) { this.draw(); this.contentEl.querySelector<HTMLButtonElement>(".qa-model-edit")?.focus(); }
        }
      }).open();
    });
    hostSwitch(tools, on, `在对话中使用 ${label}`, async (checked) => {
      if (this.busy) return;
      if (checked) enabled.add(id); else enabled.delete(id);
      const next = { ...provider, manualModels: manualProviderModels(provider), enabledModels: ids.filter((item) => enabled.has(item)) };
      if (!checked && provider.model === id) next.model = next.enabledModels[0] ?? "";
      if (checked && !provider.model) next.model = id;
      await this.updateModel(next);
    }).setDisabled(Boolean(this.busy));
  }

  private async updateModel(provider: ProviderConfig): Promise<void> {
    if (this.busy) return;
    this.busy = "save-model"; this.modelError = ""; this.draw();
    try { await this.save(provider); }
    catch (error) { this.modelError = connectionError(error); }
    finally { this.busy = ""; if (!this.closed) this.draw(); }
  }

  private drawModelPage(provider: ProviderConfig): void {
    const id = this.detailModel;
    const model = providerModels(provider).find((item) => item.id === id);
    modalTitle(this, model?.name || id, undefined, () => { if (!this.busy) this.returnToModels(id); });
    this.drawModelIdentity(id, model?.name ?? id);
    const section = this.contentEl.createDiv({ cls: "qa-ms-section qa-ms-model-parameters" });
    sectionHead(section, ct("modelSettings"));
    const options = provider.modelOptions?.[id] ?? {};
    const save = async (patch: Partial<ModelOptions>) => {
      if (this.busy) return;
      const latest = this.provider;
      if (!latest || !providerModels(latest).some(model => model.id === id)) return;
      const next: ModelOptions = { ...(latest.modelOptions?.[id] ?? {}), ...patch };
      for (const key of Object.keys(next) as Array<keyof ModelOptions>) if (next[key] === undefined) delete next[key];
      this.busy = "save-model"; this.modelError = ""; this.draw();
      try { await this.save({ ...latest, modelOptions: { ...latest.modelOptions, [id]: next } }); }
      catch (error) { this.modelError = connectionError(error); }
      finally { this.busy = ""; if (!this.closed) this.draw(); }
    };
    const auto = resolveModel({ provider: provider.provider, models: provider.models }, id);
    const reported = [model?.contextWindow ? `${compactTokens(model.contextWindow)} 上下文` : "", model?.maxOutputTokens ? `最多输出 ${compactTokens(model.maxOutputTokens)}` : "", model?.reasoning ? "支持思考" : "", model?.vision ? "支持图片" : ""].filter(Boolean);
    const intro = section.createDiv({ cls: "qa-ms-note" });
    intro.setText(`${model?.name && model.name !== id ? `${id} · ` : ""}${reported.length ? `服务商提供：${reported.join("、")}` : "服务商没有提供能力信息，可以在下面手动指定"}`);
    const list = section.createDiv({ cls: "qa-ms-list qa-ms-options" });

    const detected = (value: boolean | undefined) => value === undefined ? "未知" : value ? "支持" : "不支持";
    this.tristate(list, "思考模式", `自动：${detected(auto.thinking)}`, options.reasoning, ["开启", "关闭"], (value) => void save({ reasoning: value }));
    this.tristate(list, "图片输入", `自动：${detected(auto.vision)}`, options.vision, ["支持", "不支持"], (value) => void save({ vision: value }));
    const number = (title: string, hint: string, value: number | undefined, attr: Record<string, string>, onValue: (value: number | undefined) => void) => {
      const row = this.optionRow(list, title, hint);
      const input = row.createEl("input", { type: "number", cls: "qa-ms-input qa-ms-number", attr: { ...attr, placeholder: "自动" } });
      const name = row.querySelector<HTMLElement>(".qa-ms-row-name");
      if (name) { name.id = `qa-option-${crypto.randomUUID()}`; input.setAttribute("aria-labelledby", name.id); }
      input.value = value === undefined ? "" : String(value);
      input.addEventListener("change", () => {
        if (input.value !== "" && (!input.validity.valid || !Number.isFinite(input.valueAsNumber))) { new Notice(`${title}超出允许范围`); input.value = value === undefined ? "" : String(value); return; }
        onValue(input.value === "" ? undefined : input.valueAsNumber);
      });
    };
    number("上下文窗口", `留空：${auto.contextWindow ? compactTokens(auto.contextWindow) : "未知"}`, options.contextWindow, { min: "1", step: "1" }, (value) => {
      if (value !== undefined && !Number.isInteger(value)) { new Notice("上下文窗口需要是正整数"); return; }
      void save({ contextWindow: value });
    });
    if (provider.provider !== "chatgpt") number("最大输出 Token", "留空：服务商默认", options.maxOutputTokens, { min: "1", max: String(model?.maxOutputTokens ?? 1_000_000), step: "1" }, (value) => void save({ maxOutputTokens: value }));
    // Thinking models fix their own sampling temperature.
    if (provider.provider !== "chatgpt" && !resolveModel(provider, id).efforts.length) number("温度", "0–2，留空：服务商默认", options.temperature, { min: "0", max: "2", step: "0.1" }, (value) => void save({ temperature: value }));
    if (this.busy) this.contentEl.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input, button").forEach(control => { control.disabled = true; });
  }

  private returnToModels(focusId: string): void {
    this.detailModel = ""; this.modelEditDraft = null; this.modelError = "";
    this.draw();
    [...this.contentEl.querySelectorAll<HTMLElement>(".qa-ms-model")].find(row => row.dataset.modelId === focusId)?.querySelector<HTMLButtonElement>(".qa-model-edit")?.focus();
  }

  private drawModelIdentity(id: string, name: string): void {
    const draft = this.modelEditDraft ??= { id, name };
    const form = this.contentEl.createDiv({ cls: "qa-ms-form qa-ms-model-identity" });
    const modelId = labeledInput(field(form, ct("modelId")), ct("modelId"), "text", "qa-ms-input is-mono", { autocomplete: "off", spellcheck: "false" });
    modelId.value = draft.id;
    const displayName = labeledInput(field(form, ct("displayName")), ct("displayName"), "text", "qa-ms-input");
    displayName.value = draft.name;
    if (this.modelError) form.createDiv({ cls: "qa-inline-error", text: this.modelError, attr: { role: "alert" } });
    const actions = form.createDiv({ cls: "qa-ms-form-actions" });
    const cancel = actions.createEl("button", { cls: "qa-ms-button is-quiet", text: ct("cancel"), attr: { type: "button" } });
    cancel.addEventListener("click", () => { if (!this.busy) this.returnToModels(id); });
    const submit = actions.createEl("button", { cls: "qa-ms-button", text: this.busy === "edit-model" ? ct("saving") : ct("saveModel"), attr: { type: "button" } });
    const refresh = () => { submit.disabled = Boolean(this.busy) || (draft.id.trim() === id && draft.name.trim() === name); };
    modelId.addEventListener("input", () => { draft.id = modelId.value; refresh(); });
    displayName.addEventListener("input", () => { draft.name = displayName.value; refresh(); });
    const save = async () => {
      if (this.busy) return;
      const latest = this.provider;
      if (!latest) return;
      this.busy = "edit-model"; this.modelError = ""; this.draw();
      try {
        const next = editProviderModel(latest, id, draft.id, draft.name);
        await persistProviderModelChange(this.plugin.settings, next, id, draft.id.trim(), () => this.plugin.saveSettings());
        this.detailModel = ""; this.modelEditDraft = null;
        new Notice(ct("modelSaved"));
      } catch (error) { this.modelError = connectionError(error); }
      finally { this.busy = ""; if (!this.closed) { if (this.detailModel) this.draw(); else this.returnToModels(draft.id.trim()); } }
    };
    submit.addEventListener("click", () => void save());
    form.addEventListener("keydown", event => {
      if (event.key === "Enter" && !event.isComposing && (event.target === modelId || event.target === displayName) && !submit.disabled) { event.preventDefault(); void save(); }
    });
    refresh();
  }

  private optionRow(list: HTMLElement, title: string, hint: string): HTMLElement {
    const row = list.createDiv({ cls: "qa-ms-option" });
    const text = row.createDiv({ cls: "qa-ms-row-text" });
    text.createDiv({ cls: "qa-ms-row-name", text: title });
    text.createDiv({ cls: "qa-ms-row-sub", text: hint });
    return row;
  }

  /** 自动 / on / off; the hint names what 自动 resolves to. */
  private tristate(list: HTMLElement, title: string, hint: string, value: boolean | undefined, [on, off]: [string, string], onChange: (value: boolean | undefined) => void): void {
    const group = this.optionRow(list, title, hint).createDiv({ cls: "qa-segments", attr: { role: "radiogroup" } });
    labelGroup(group, title);
    for (const [choice, text] of [[undefined, "自动"], [true, on], [false, off]] as const) {
      const button = group.createEl("button", { text, attr: { type: "button", role: "radio", "aria-checked": String(value === choice) } });
      button.addEventListener("click", () => { if (value !== choice) onChange(choice); });
    }
  }

  private async testModel(provider: ProviderConfig, key: string): Promise<void> {
    const model = provider.model || provider.enabledModels?.[0];
    if (!model || this.busy) return;
    const operation = new AbortController(); this.operation = operation;
    this.busy = "test"; this.draw();
    try {
      await verifyModel(this.app, provider, key, model, operation.signal);
      new Notice(`${model} 测试成功`);
    } catch (error) { new Notice(`测试失败：${connectionError(error)}`); }
    finally { this.busy = ""; if (!this.closed) this.draw(); }
  }
}

/** A local agent: which of its models appear in the composer; login and models belong to the agent. */
class AgentModal extends Modal {
  private busy = false;
  private error = "";
  private closed = false;
  private readonly backendOwner = `model-settings-${crypto.randomUUID()}`;
  constructor(app: App, private readonly plugin: QiaomuAgentPlugin, private readonly agent: CliDetection, private readonly onChange: () => void) { super(app); }
  override onOpen(): void { this.modalEl.addClass("qa-provider-modal"); this.draw(); }
  private draw(): void {
    if (this.closed) return;
    modalTitle(this, this.agent.label, { key: agentIconKey(this.agent.id), fallback: "bot" });
    const { contentEl } = this;
    contentEl.empty();
    const settings = this.plugin.settings;
    const reported = settings.agentModelCache[this.agent.id]?.models ?? [];
    const custom = settings.agentCustomModels[this.agent.id] ?? [];
    const models = [...reported, ...custom.filter((id) => !reported.some((model) => model.id === id)).map((id) => ({ id, name: id, efforts: [] }))];
    const visible = settings.agentEnabledModels[this.agent.id];
    const isVisible = (id: string) => !visible || visible.includes(id);
    const canList = Boolean(nativeTransportFor(this.agent.id, this.agent.nativePath)) || this.agent.id === "antigravity" || this.agent.id === "pi";
    const section = contentEl.createDiv({ cls: "qa-ms-section" });
    const count = models.filter((model) => isVisible(model.id)).length + Number(isVisible(""));
    const actions = sectionHead(section, "模型", `打开的模型会出现在对话的模型菜单里 · 已启用 ${count} / ${models.length + 1}`);
    if (canList) {
      const refresh = actionButton(actions, "refresh-cw", this.busy ? "读取中…" : models.length ? "重新读取" : "读取模型", this.busy ? "is-busy" : "");
      refresh.disabled = this.busy;
      refresh.addEventListener("click", () => void this.loadModels());
    }
    if (this.error) section.createDiv({ cls: "qa-inline-error", text: this.error, attr: { role: "alert" } });
    const search = models.length > 10 ? labeledInput(section, "搜索模型", "search", "qa-ms-input qa-ms-search", { placeholder: "搜索模型" }) : null;
    const list = section.createDiv({ cls: "qa-ms-list qa-ms-models" });
    const rows: Array<{ row: HTMLElement; text: string }> = [];
    const addChoice = (id: string, name: string, detail = "") => {
      const row = list.createDiv({ cls: `qa-ms-model${isVisible(id) ? " is-on" : ""}` });
      rows.push({ row, text: `${name} ${id}`.toLowerCase() });
      const text = row.createDiv({ cls: "qa-ms-row-text" });
      text.createDiv({ cls: "qa-ms-row-name", text: name });
      if (detail) text.createDiv({ cls: "qa-ms-row-sub", text: detail });
      hostSwitch(row.createDiv({ cls: "qa-ms-model-tools" }), isVisible(id), `在对话中使用 ${name}`, (checked) => void this.setModelVisible(id, checked, models));
    };
    addChoice("", "默认模型", this.agent.id === "zcode" ? "在 ZCode 中更换具体模型" : "使用该 Agent 当前设置的模型");
    for (const model of models) addChoice(model.id, model.name || model.id, model.name !== model.id ? model.id : custom.includes(model.id) ? "手动添加" : "");
    search?.addEventListener("input", () => {
      const query = search.value.trim().toLowerCase();
      for (const item of rows) item.row.hidden = Boolean(query) && !item.text.includes(query);
    });
    if (!reported.length) section.createDiv({ cls: "qa-ms-note", text: canList ? "点“读取模型”获取列表，之后会保存下来。" : "该 Agent 不提供模型列表，可使用默认模型或手动添加模型 ID。" });
    if (this.agent.id !== "zcode") {
      const manual = section.createDiv({ cls: "qa-ms-add" });
      const input = labeledInput(manual, "手动添加模型 ID", "text", "qa-ms-input is-mono", { placeholder: "手动添加模型 ID", autocomplete: "off", spellcheck: "false" });
      const submit = async () => {
        const id = input.value.trim();
        if (!id || id.length > 160 || models.some((model) => model.id === id)) { new Notice("请输入尚未添加的模型 ID"); return; }
        settings.agentCustomModels[this.agent.id] = [...custom, id];
        if (settings.agentEnabledModels[this.agent.id]) settings.agentEnabledModels[this.agent.id]!.push(id);
        await this.plugin.saveSettings(); this.draw();
      };
      manual.createEl("button", { cls: "qa-ms-button", text: "添加", attr: { type: "button" } }).addEventListener("click", () => void submit());
      input.addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.isComposing) void submit(); });
    }
    if (this.agent.note) contentEl.createDiv({ cls: "qa-ms-note", text: this.agent.note });
    const info = contentEl.createDiv({ cls: "qa-ms-section" });
    sectionHead(info, "本机程序", "登录与账号由 Agent 自己管理，首次使用时确认。");
    const facts = info.createDiv({ cls: "qa-ms-list qa-ms-facts" });
    for (const [name, value] of [["版本", this.agent.version ?? "未知"], ["连接方式", nativeTransportLabel(this.agent.id) || "命令行"], ["位置", this.agent.path ?? "未知"]] as const) {
      const row = facts.createDiv({ cls: "qa-ms-fact" });
      row.createSpan({ text: name });
      row.createSpan({ cls: name === "位置" ? "is-mono" : "", text: value });
    }
  }
  private async setModelVisible(id: string, shown: boolean, models: ModelChoice[]): Promise<void> {
    const settings = this.plugin.settings;
    const current = settings.agentEnabledModels[this.agent.id] ?? ["", ...models.map((model) => model.id)];
    settings.agentEnabledModels[this.agent.id] = shown ? [...new Set([...current, id])] : current.filter((value) => value !== id);
    await this.plugin.saveSettings(); this.draw();
  }
  private async loadModels(): Promise<void> {
    if (this.busy) return;
    this.busy = true; this.error = ""; this.draw();
    try {
      const backend = this.plugin.backendService.resolve(`cli:${this.agent.id}`, this.backendOwner);
      const request: ChatRequest = { prompt: "", systemPrompt: "", cwd: this.plugin.skillService.getVaultRoot(), permissionMode: "plan", history: [], mcpConfig: {} };
      const models = await backend.listModels?.(request) ?? [];
      if (!models.length) throw new Error("该 Agent 没有返回模型列表，请在聊天中使用其默认模型。");
      this.plugin.settings.agentModelCache[this.agent.id] = { models: models.map(({ id, name, efforts }) => ({ id, name, efforts })), fetchedAt: Date.now() };
      await this.plugin.saveSettings();
    } catch (error) { this.error = error instanceof Error ? error.message : String(error); }
    finally { await this.plugin.backendService.release(this.backendOwner); this.busy = false; this.draw(); }
  }
  override onClose(): void { this.closed = true; this.contentEl.empty(); this.onChange(); void this.plugin.backendService.release(this.backendOwner); }
}
