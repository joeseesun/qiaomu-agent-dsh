import { Modal, Notice, Setting, type App } from "obsidian";
import type QiaomuAgentPlugin from "../main";
import type { ChatRequest } from "../types";
import { buildSystemPrompt } from "../services/agent-prompt";
import { diffWords, inlineTargetIsCurrent, parseInlineReplacement, type InlineTarget } from "../services/inline-edit";

export class InlineEditModal extends Modal {
  private instruction = "";
  private replacement = "";
  private status = "";
  private error = "";
  private running = false;
  private readonly controller = new AbortController();
  private readonly owner = crypto.randomUUID();

  constructor(app: App, private readonly plugin: QiaomuAgentPlugin, private readonly target: InlineTarget) { super(app); }

  override onOpen(): void {
    this.modalEl.addClass("qa-inline-edit-modal");
    this.shouldRestoreSelection = false;
    this.renderInput();
  }

  override onClose(): void {
    this.controller.abort();
    void this.plugin.backendService.release(this.owner);
    this.contentEl.empty();
  }

  private currentPath(): string | null {
    const leaf = this.app.workspace.getLeavesOfType("markdown")
      .find((candidate) => "editor" in candidate.view && candidate.view.editor === this.target.editor);
    return leaf?.view instanceof Object && "file" in leaf.view && leaf.view.file && typeof leaf.view.file === "object" && "path" in leaf.view.file
      ? String(leaf.view.file.path) : null;
  }

  private contextLabel(): string {
    const matching = this.history();
    let model = "";
    try {
      const settings = this.plugin.settings;
      const selected = settings.backendKind === "cli" && settings.preferredCli ? `cli:${settings.preferredCli}` : settings.backendKind;
      const backend = this.plugin.backendService.resolve(selected, this.owner);
      const key = backend.id === "api" ? `api:${settings.api.provider}:${settings.api.baseUrl}` : backend.id;
      model = settings.modelSelections?.[key]?.model || (backend.id === "api" ? settings.api.model : backend.label);
    } catch { model = "未连接模型"; }
    return `${this.target.path} · 选中 ${this.target.original.length} 字 · ${model}${this.target.document.length > 24_000 ? " · 笔记上下文节选" : ""}${matching.length ? " · 含本笔记最近对话" : ""}`;
  }

  private history() {
    const conversation = this.plugin.settings.lastConversation;
    const matching = conversation.flatMap((message, index) => {
      if (message.role !== "assistant" || message.sourcePath !== this.target.path) return [];
      const previous = conversation[index - 1];
      return previous?.role === "user" ? [previous, message] : [message];
    });
    return matching.slice(-6).map((message) => ({ ...message, content: message.content.slice(0, 2_000) }));
  }

  private renderInput(): void {
    this.contentEl.empty();
    this.titleEl.setText("改写选中内容");
    this.contentEl.createDiv({ cls: "qa-inline-edit-context", text: this.contextLabel() });
    const label = this.contentEl.createEl("label", { cls: "qiaomu-agent__sr-only", text: "改写要求" });
    const input = this.contentEl.createEl("textarea", {
      cls: "qa-inline-edit-input",
      attr: { placeholder: "例如：写得更正式，保留原意", rows: "3" },
    });
    input.id = `qa-inline-edit-${crypto.randomUUID()}`;
    label.htmlFor = input.id;
    input.value = this.instruction;
    input.addEventListener("input", () => { this.instruction = input.value; this.error = ""; });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void this.generate(); }
    });
    const presets = this.contentEl.createDiv({ cls: "qa-inline-edit-presets" });
    for (const [label, instruction] of [
      ["润色", "保持原意，写得更清楚自然。"],
      ["精简", "保留关键信息，删去重复和冗余。"],
      ["正式", "保持原意，改为正式、准确的书面表达。"],
      ["译成英文", "准确翻译为自然的英语，保留 Markdown 格式。"],
    ]) {
      presets.createEl("button", { text: label, attr: { type: "button" } }).addEventListener("click", () => {
        this.instruction = instruction!;
        void this.generate();
      });
    }
    this.contentEl.createDiv({ cls: "qa-inline-edit-original", text: this.target.original });
    if (this.error) this.contentEl.createDiv({ cls: "qa-inline-edit-error", text: this.error, attr: { role: "alert" } });
    if (this.status) this.contentEl.createDiv({ cls: "qa-inline-edit-status", text: this.status, attr: { role: "status" } });
    new Setting(this.contentEl).addButton((button) => button.setButtonText("取消").onClick(() => this.close()))
      .addButton((button) => button.setButtonText(this.running ? "正在生成…" : "生成预览").setCta().setDisabled(this.running).onClick(() => void this.generate()));
    if (!this.running) input.focus();
  }

  private async generate(): Promise<void> {
    if (this.running) return;
    this.instruction = this.instruction.trim();
    if (!this.instruction) { this.error = "请先写下改写要求"; this.renderInput(); return; }
    if (!inlineTargetIsCurrent(this.target, this.currentPath())) {
      this.error = "原文已经变化，请重新选中后再改写"; this.renderInput(); return;
    }
    this.running = true; this.status = "正在生成预览…"; this.error = ""; this.renderInput();
    try {
      const settings = this.plugin.settings;
      const selected = settings.backendKind === "cli" && settings.preferredCli ? `cli:${settings.preferredCli}` : settings.backendKind;
      const backend = this.plugin.backendService.resolve(selected, this.owner);
      const key = backend.id === "api" ? `api:${settings.api.provider}:${settings.api.baseUrl}` : backend.id;
      const model = settings.modelSelections?.[key];
      const at = this.target.editor.posToOffset(this.target.from);
      const note = this.target.document.length <= 24_000 ? this.target.document
        : this.target.document.slice(Math.max(0, at - 8_000), Math.min(this.target.document.length, at + this.target.original.length + 8_000));
      const request: ChatRequest = {
        prompt: `改写要求：${this.instruction}\n\n只改写 <editor_selection> 的文字。仅返回 <replacement>改写后的完整文字</replacement>，不要解释、代码围栏或修改文件。`,
        systemPrompt: buildSystemPrompt(`${settings.systemPrompt}\n\n当前是选区改写预览。你只能给出替换文本，不得使用工具写入文件。保留原文的 Markdown、链接和事实，除非改写要求明确让你修改。`),
        cwd: this.plugin.skillService.getVaultRoot(),
        model: model?.model || (backend.id === "api" ? settings.api.model : undefined),
        reasoningEffort: model?.effort || undefined,
        permissionMode: "plan",
        activeFilePath: this.target.path,
        activeFileContent: note,
        selection: { path: this.target.path, startLine: this.target.from.line + 1, endLine: this.target.to.line + 1, text: this.target.original },
        history: this.history(),
        mcpConfig: {},
      };
      let response = "";
      await backend.send(request, {
        onText: (text) => { response += text; },
        onStatus: (status) => { if (!this.controller.signal.aborted) { this.status = status; this.renderInput(); } },
        requestApproval: async () => null,
      }, this.controller.signal);
      this.controller.signal.throwIfAborted();
      this.replacement = parseInlineReplacement(response);
      this.running = false; this.status = ""; this.renderPreview();
    } catch (error) {
      if (this.controller.signal.aborted) return;
      this.error = error instanceof Error ? error.message : String(error);
      this.running = false; this.status = ""; this.renderInput();
    }
  }

  private renderPreview(): void {
    this.contentEl.empty();
    this.titleEl.setText("确认改写");
    this.contentEl.createDiv({ cls: "qa-inline-edit-context", text: this.contextLabel() });
    const preview = this.contentEl.createDiv({ cls: "qa-inline-edit-preview" });
    for (const change of diffWords(this.target.original, this.replacement)) {
      const span = preview.createSpan({ text: change.text, cls: `qa-inline-edit-${change.type}` });
      if (change.type === "del" || change.type === "add") {
        const prefix = document.createElement("span");
        prefix.className = "qiaomu-agent__sr-only";
        prefix.textContent = change.type === "del" ? "删除：" : "新增：";
        span.prepend(prefix);
      }
    }
    if (!inlineTargetIsCurrent(this.target, this.currentPath())) {
      this.contentEl.createDiv({ cls: "qa-inline-edit-error", text: "原文已经变化，请重新选中后再改写", attr: { role: "alert" } });
    }
    new Setting(this.contentEl).addButton((button) => button.setButtonText("放弃").onClick(() => this.close()))
      .addButton((button) => button.setButtonText("调整要求").onClick(() => { this.renderInput(); }))
      .addButton((button) => button.setButtonText("再生成").onClick(() => void this.generate()))
      .addButton((button) => button.setButtonText("复制").onClick(() => void navigator.clipboard.writeText(this.replacement)
        .then(() => new Notice("已复制改写结果"))
        .catch(() => new Notice("复制失败，请重试"))))
      .addButton((button) => button.setButtonText("替换选中内容").setCta().onClick(() => this.apply()));
  }

  private apply(): void {
    if (!inlineTargetIsCurrent(this.target, this.currentPath())) {
      new Notice("原文已经变化，未替换；请重新选中后再试");
      this.renderPreview();
      return;
    }
    this.target.editor.replaceRange(this.replacement, this.target.from, this.target.to);
    this.close();
    new Notice("已替换选中内容，可用撤销恢复");
  }
}
