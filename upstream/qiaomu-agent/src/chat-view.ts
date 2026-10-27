import { ItemView, MarkdownView, Menu, Notice, Platform, TFile, TFolder, Vault, WorkspaceLeaf, normalizePath } from "obsidian";
import { readingLabel } from "./integrations/reading-prompt";
import type { ContextSnapshot } from "./integrations/qiaomu-context";
import type { ReadingChip } from "./ui/chat-panel";
import { buildSystemPrompt } from "./services/agent-prompt";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Chat } from "@ai-sdk/react";
import type QiaomuAgentPlugin from "./main";
import type { AgentSkill, PermissionMode, ChatAttachment, ChatMessage, ChatRequest, EditorSelectionContext, GeneratedAttachment, QuestionAnswers, QuestionRequest } from "./types";
import { ADD_COMMANDS, commandHotkey, type AddKind } from "./services/hotkeys";
import { FilePicker, FolderPicker, AppendDialog, FullAccessDialog, WebPageDialog } from "./ui/host-dialogs";
import { PromptLibraryModal } from "./ui/prompt-library-panel";
import type { PromptItem } from "./services/prompt-library";
import { folderAttachment, webPageAttachment, readAttachment, validateAttachments, FOLDER_NOTE_LIMIT, MAX_ATTACHMENT_BYTES } from "./services/attachments";
import { AgentTransport, fromStoredMessage, toStoredMessage, messageText, type AgentMessage, type TurnHooks } from "./services/chat-transport";
import { TurnChangeTracker, toVaultPath } from "./services/change-tracker";
import { RevertDialog } from "./ui/revert-dialog";
import { externalFiles } from "./services/local-host";
import { ChatPanel } from "./ui/chat-panel";
import { ModelManagerModal } from "./settings-tab";
import { CapabilitiesModal } from "./ui/capabilities-modal";
import { applyChatTheme } from "./services/palettes";
import { chatFontStack, codeFontStack } from "./services/fonts";
import { enabledMcpConfig } from "./services/mcp-config";
import { getRuntimeRequire } from "./services/runtime-require";
import { ApiBackend, nativeWebSearchProvider } from "./services/api-backend";
import { readWebPage } from "./services/web-page";
import { WEB_SEARCH_SECRET_ID } from "./services/web-search";
import { apiProtocol, permitsEmptyKey } from "./services/api-providers";
import { checkImageInput, resolveModel } from "./services/model-capabilities";
import { activeProvider, agentShown, chooseModel, exposedModels, findProvider, providerIcon, providerLabel, visibleAgentModels, type ModelSource } from "./services/model-sources";
import { nativeTransportFor } from "./services/native-agent-backend";
import { agentIconKey } from "./ui/brand-icon";
import { activeIdentity, conversationTitle, forkConversation, openConversation, startConversation } from "./services/conversations";
import type { PickerSelection } from "./ui/model-picker";

export const VIEW_TYPE_QIAOMU_AGENT = "qiaomu-agent-view";

export class ChatView extends ItemView {
  chat!: Chat<AgentMessage>;
  private root: Root | null = null;
  private selectedSkill: AgentSkill | null = null;
  private selectedBackend = "auto";
  private attachNote = true;
  /** Selection the user removed from the composer; it comes back when the selection changes. */
  private dismissedSelection = "";
  private shownSelection = "";
  private prefill = "";
  private prefillVersion = 0;
  private submitVersion = 0;
  private focusVersion = 0;
  private addRequest: { kind: AddKind; version: number } = { kind: "upload", version: 0 };
  private promptRequest: { id: string; version: number } = { id: "", version: 0 };
  private statusText = "";
  private persistQueue: Promise<void> = Promise.resolve();
  private readonly backendOwner = crypto.randomUUID();
  private readonly sourceState = new Map<string, { loading?: boolean; error?: string }>();
  /** Pending approval cards: id → resolver for the agent's request. */
  private readonly approvals = new Map<string, (choice: string | null) => void>();
  /** Open question cards: id → resolver for the agent's questions. */
  private readonly questions = new Map<string, (answers: QuestionAnswers | null) => void>();

  constructor(leaf: WorkspaceLeaf, readonly plugin: QiaomuAgentPlugin) { super(leaf); }
  getViewType(): string { return VIEW_TYPE_QIAOMU_AGENT; }
  getDisplayText(): string { return "乔木 Agent"; }
  override getIcon(): string { return "tree-deciduous"; }
  override async onOpen(): Promise<void> { await this.ensureReady(); }

  async ensureReady(): Promise<void> {
    if (this.root) return;
    this.attachNote = this.plugin.settings.autoAttachActiveNote;
    this.contentEl.empty();
    this.contentEl.addClass("qiaomu-agent", "qiaomu-agent--react");
    this.chat = new Chat<AgentMessage>({
      messages: this.plugin.settings.lastConversation.map((message) => fromStoredMessage(message, (attachment) => this.resolveAttachment(attachment))),
      transport: new AgentTransport(async (messages, signal) => {
        // Capture every input before the first await: navigation cannot change this turn.
        const settings = this.plugin.settings;
        const backend = this.plugin.backendService.resolve(this.selectedBackend, this.backendOwner);
        const last = messages.at(-1);
        if (!last || last.role !== "user") throw new Error("没有待发送的用户消息");
        const imageEdit = last.metadata?.attachments?.some((attachment) => attachment.intent === "edit") ?? false;
        // Image editing produces a chat artifact; inserting it into a note is a separate, confirmed action.
        const permissionMode = imageEdit ? "plan" : settings.permissionMode === "full" && !fullAccessFor(backend.id) ? "edit" : settings.permissionMode;
        const file = !imageEdit && this.attachNote ? this.plugin.getActiveMarkdownFile() : null;
        const parsed: unknown = backend.id === "api" ? {} : enabledMcpConfig(settings.mcpConfig, settings.disabledMcpServers);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("MCP 配置需要是 JSON 对象");
        const selection = imageEdit ? null : this.activeSelection();
        const reading = imageEdit ? null : this.plugin.reading.current();
        if (reading) this.plugin.reading.consumed();
        const modelId = settings.modelSelections?.[this.selectionKey()]?.model || settings.api.model;
        const modelOptions = backend.id === "api" ? activeProvider(settings)?.modelOptions?.[modelId] : undefined;
        const provider = backend.id === "api" ? activeProvider(settings) : undefined;
        const capabilities = provider ? resolveModel(provider, modelId) : undefined;
        const contextWindow = capabilities?.contextWindow;
        const effort = settings.modelSelections?.[this.selectionKey()]?.effort || undefined;
        if (capabilities && effort && !capabilities.efforts.includes(effort)) throw new Error("这个模型没有开启思考模式，请把推理强度改为默认，或在模型设置中开启思考模式");
        if (capabilities) checkImageInput(capabilities, last.metadata?.attachments ?? []);
        const systemPrompt = settings.systemPrompt;
        const request = {
          prompt: imageEdit && backend.id === "cli:codex"
            ? `请使用图像编辑或生成工具，以附带图片为参考生成修改后的图片，并在回复中展示结果。不要修改笔记或其他文件。用户的修改要求：${messageText(last)}`
            : messageText(last), systemPrompt: buildSystemPrompt(systemPrompt),
          selection: selection ?? undefined,
          reading: reading ?? undefined,
          cwd: this.plugin.skillService.getVaultRoot(),
          model: settings.modelSelections?.[this.selectionKey()]?.model || (backend.id === "api" ? settings.api.model : undefined),
          modelOptions,
          contextWindow,
          reasoningEffort: effort,
          attachments: last.metadata?.attachments,
          permissionMode, webSearch: settings.webSearch !== false, skill: this.selectedSkill && !settings.disabledSkillPaths.includes(this.selectedSkill.path) ? this.selectedSkill : undefined,
          activeFilePath: file?.path,
          mcpConfig: parsed as Record<string, unknown>,
          obsidianCli: settings.useObsidianCli ? this.plugin.obsidianCliService.getConnection() : undefined,
          history: messages.slice(0, -1).map(toStoredMessage),
        };
        validateAttachments(request.attachments ?? [], backend.id);
        const trackChanges = backend.id.startsWith("cli:") || (backend.id === "api" && permissionMode !== "plan");
        const [vaultInstructions, activeFileContent, snapshots] = await Promise.all([
          backend.id === "api" ? this.vaultInstructions() : undefined,
          file ? this.app.vault.cachedRead(file) : undefined,
          trackChanges ? this.mentionedSnapshots(request.prompt, file?.path ?? "") : undefined,
        ]);
        signal.throwIfAborted();
        // Every turn can ask questions; only tracked turns also get file hooks.
        let turn: TurnHooks = { awaitAnswers: this.awaitAnswers };
        if (snapshots) {
          if (file && activeFileContent !== undefined) snapshots.set(file.path, activeFileContent);
          turn = this.turnHooks(snapshots);
        }
        return { backend, request: { ...request, systemPrompt: buildSystemPrompt(systemPrompt, vaultInstructions), activeFileContent }, turn };
      }, (attachment) => this.storeGeneratedAttachment(attachment)),
      onData: (part) => {
        if (part.type === "data-status") { this.statusText = part.data; this.render(); }
      },
      onFinish: () => { this.statusText = ""; void this.persist(); this.render(); },
      onError: () => { this.statusText = ""; void this.persist(); this.render(); },
    });
    this.root = createRoot(this.contentEl);
    this.refreshControls();
  }

  override async onClose(): Promise<void> {
    this.highlightSelection(false);
    if (!this.chat) return;
    await this.chat.stop();
    await this.plugin.backendService.release(this.backendOwner);
    await this.persist();
    this.root?.unmount();
    this.root = null;
  }

  setComposer(text: string): void { this.prefill = text; this.prefillVersion++; this.render(); }
  /** A question from outside (Qiaomu Home): new conversation, draft it, and send when asked and idle. */
  compose(text: string, submit: boolean): void {
    if (!this.running() && this.chat.messages.length) this.newConversation();
    this.prefill = text; this.prefillVersion++;
    if (submit && !this.running()) this.submitVersion++;
    this.render();
  }
  /** Shows an archived conversation, or the active one, e.g. when chosen on Qiaomu Home. */
  showConversationById(id: string): void {
    if (activeIdentity(this.plugin.settings).id === id) { this.focusComposer(); return; }
    this.openConversation(id);
  }
  /** Focuses the composer without touching a draft the user is writing. */
  focusComposer(): void { this.focusVersion++; this.render(); }
  /** Runs a composer add action (from a command hotkey) as if chosen from the add menu. */
  /** Runs a prompt from the command palette as if its chip had been clicked. */
  requestPrompt(id: string): void { this.promptRequest = { id, version: this.promptRequest.version + 1 }; this.render(); }
  requestAdd(kind: AddKind): void { if (this.running()) return; this.addRequest = { kind, version: this.addRequest.version + 1 }; this.render(); }
  refreshReading(): void { if (this.root) this.render(); }
  refreshSelection(): void {
    if (!this.root) return;
    const selection = this.activeSelection();
    const key = selection ? this.editorSelectionKey(selection) : "";
    if (key !== this.shownSelection) this.render();
  }
  newConversation(): void {
    if (this.running()) return;
    startConversation(this.plugin.settings, this.chat.messages.map(toStoredMessage));
    this.showConversation([]);
  }
  private showConversation(messages: ChatMessage[]): void {
    this.chat.messages = messages.map((message) => fromStoredMessage(message, (attachment) => this.resolveAttachment(attachment)));
    this.chat.clearError();
    this.plugin.backendService.resetSessions(this.backendOwner);
    this.statusText = "";
    void this.persist();
    this.render();
  }
  private openConversation(id: string): void {
    if (this.running()) return;
    const messages = openConversation(this.plugin.settings, this.chat.messages.map(toStoredMessage), id);
    if (!messages) { new Notice("原对话已不在历史记录中"); return; }
    this.showConversation(messages);
  }
  private forkFromMessage(messageId: string): void {
    if (this.running()) return;
    const messages = forkConversation(this.plugin.settings, this.chat.messages.map(toStoredMessage), messageId);
    if (!messages) { new Notice("这条回复无法创建分支"); return; }
    this.showConversation(messages);
    new Notice("已创建对话分支；两个对话仍共用当前笔记库");
  }
  refreshControls(): void {
    const settings = this.plugin.settings;
    const selected = this.plugin.backendService.effectiveSelection(settings.backendKind === "cli" && settings.preferredCli ? `cli:${settings.preferredCli}` : settings.backendKind);
    this.selectedBackend = selected;
    this.render();
    const ready = this.plugin.backendService.getBackendOptions().find((option) => option.value === selected)?.ready;
    if (this.root && ready && !this.running()) {
      const backend = this.plugin.backendService.resolve(this.selectedBackend, this.backendOwner);
      const key = this.selectionKey();
      const selection = settings.modelSelections?.[key];
      // Only the selected persistent transport is prepared. No inference or note reads.
      void backend.prepare?.({
        prompt: "", systemPrompt: buildSystemPrompt(settings.systemPrompt), history: [],
        model: selection?.model, reasoningEffort: selection?.effort || undefined,
        cwd: this.plugin.skillService.getVaultRoot(),
        permissionMode: settings.permissionMode === "full" && !fullAccessFor(backend.id) ? "edit" : settings.permissionMode,
      }).catch((error: unknown) => console.debug("Qiaomu Agent: preparation failed; send will retry", error));
    }
  }

  private selectionKey(): string {
    const backend = this.plugin.backendService.resolve(this.selectedBackend, this.backendOwner);
    const api = this.plugin.settings.api;
    return backend.id === "api" ? `api:${api.provider}:${api.baseUrl}` : backend.id;
  }
  private chooseFile(choose: (attachment: ChatAttachment) => void): void {
    new FilePicker(this.app, (file) => {
      if (file.stat.size > MAX_ATTACHMENT_BYTES) { new Notice("附件超过 5 MB 限制"); return; }
      void this.app.vault.readBinary(file).then((data) => readAttachment(new File([data], file.name), file.path)).then(choose).catch((e) => new Notice(String(e)));
    }).open();
  }
  private chooseFolder(choose: (attachment: ChatAttachment) => void): void {
    new FolderPicker(this.app, (folder: TFolder) => {
      const files: TFile[] = [];
      Vault.recurseChildren(folder, (item) => { if (item instanceof TFile && item.extension === "md") files.push(item); });
      // Read only what can be attached in full; the rest are listed by path.
      const sorted = files.sort((a, b) => a.path.localeCompare(b.path));
      void Promise.all(sorted.map(async (file, index) => ({ path: file.path, text: index < FOLDER_NOTE_LIMIT ? await this.app.vault.cachedRead(file) : "" })))
        .then((notes) => choose(folderAttachment(folder.path, notes))).catch((e) => new Notice(String(e)));
    }).open();
  }
  private chooseWebPage(choose: (attachment: ChatAttachment) => void): void {
    new WebPageDialog(this.app, async (url, signal) => choose(webPageAttachment(await readWebPage(url, signal)))).open();
  }
  /** Whether the selected API model can search the web at all; local agents search on their own. */
  private webSearchAvailable(key: string): boolean {
    if (!key.startsWith("api:")) return false;
    const provider = activeProvider(this.plugin.settings);
    return Boolean(provider && nativeWebSearchProvider(provider.provider, apiProtocol(provider))) || Boolean(this.app.secretStorage.getSecret(WEB_SEARCH_SECRET_ID));
  }
  private async append(text: string, daily: boolean): Promise<void> {
    if (!daily) { new FilePicker(this.app, (file) => new AppendDialog(this.app, file.path, text).open(), true).open(); return; }
    try {
      const cwd = this.plugin.skillService.getVaultRoot();
      if (!cwd) throw new Error("今日日记需要桌面 Obsidian CLI；此设备请使用指定文件追加");
      const path = (await this.plugin.obsidianCliService.run({ type: "daily-path" }, cwd)).trim();
      if (!path || path.includes("\n") || !path.endsWith(".md") || path.startsWith("/") || path.split("/").includes("..")) throw new Error("无法解析日记路径，请先启用日记插件");
      new AppendDialog(this.app, path, text, async () => {
        if (!this.app.vault.getAbstractFileByPath(path)) await this.plugin.obsidianCliService.run({ type: "daily-open" }, cwd);
      }).open();
    } catch (e) { new Notice(String(e)); }
  }
  private running(): boolean { return this.chat?.status === "submitted" || this.chat?.status === "streaming"; }

  private persist(): Promise<void> {
    const snapshot = this.chat.messages.slice(-80).map(toStoredMessage);
    const identity = activeIdentity(this.plugin.settings);
    if (!identity.title && snapshot.length) identity.title = conversationTitle(snapshot);
    this.persistQueue = this.persistQueue.catch(() => {}).then(async () => {
      this.plugin.settings.lastConversation = snapshot;
      await this.plugin.saveSettings();
    });
    return this.persistQueue.catch(() => { new Notice("对话保存失败，请勿关闭窗口"); });
  }
  private openConnection(): void {
    new ModelManagerModal(this.app, this.plugin).open();
  }
  /** Obsidian exposes no public call for this; the settings modal's own API is the common route. */
  private openSettings(): void {
    const setting = (this.app as unknown as { setting?: { open(): void; openTabById(id: string): unknown } }).setting;
    if (!setting) return;
    setting.open();
    setting.openTabById(this.plugin.manifest.id);
  }
  /** The editor selection in the most recent note, unless the user dismissed it from the composer. */
  private activeSelection(): EditorSelectionContext | null {
    const view = this.app.workspace.getMostRecentLeaf()?.view;
    if (!(view instanceof MarkdownView) || !view.file || view.getMode() !== "source") return null;
    const editor = view.editor;
    const text = editor.getSelection();
    if (!text.trim()) return null;
    const from = editor.getCursor("from");
    const to = editor.getCursor("to");
    // A selection ending at the start of a line does not include that line.
    const endLine = to.ch === 0 && to.line > from.line ? to.line : to.line + 1;
    const selection = { path: view.file.path, startLine: from.line + 1, endLine, text: text.slice(0, 20_000) };
    return this.editorSelectionKey(selection) === this.dismissedSelection ? null : selection;
  }
  /**
   * Keeps the selection visible in the note while focus is in the sidebar, using the CSS Custom
   * Highlight API (no document changes). Cleared when the editor regains focus or the chip goes away.
   */
  private highlightSelection(active: boolean): void {
    const registry = (globalThis as unknown as { CSS?: { highlights?: Map<string, unknown> } }).CSS?.highlights;
    const HighlightCtor = (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
    if (!registry || !HighlightCtor) return;
    registry.delete("qiaomu-selection");
    if (!active) return;
    const view = this.app.workspace.getMostRecentLeaf()?.view;
    if (!(view instanceof MarkdownView)) return;
    const cm = (view.editor as unknown as { cm?: { hasFocus: boolean; domAtPos(pos: number): { node: Node; offset: number } } }).cm;
    if (!cm || cm.hasFocus) return;
    try {
      const from = cm.domAtPos(view.editor.posToOffset(view.editor.getCursor("from")));
      const to = cm.domAtPos(view.editor.posToOffset(view.editor.getCursor("to")));
      const range = view.contentEl.ownerDocument.createRange();
      range.setStart(from.node, from.offset);
      range.setEnd(to.node, to.offset);
      registry.set("qiaomu-selection", new HighlightCtor(range));
    } catch { /* lines outside the rendered viewport cannot be highlighted */ }
  }
  private editorSelectionKey(selection: EditorSelectionContext): string {
    return `${selection.path}:${selection.startLine}-${selection.endLine}:${selection.text.length}:${selection.text.slice(0, 64)}`;
  }
  /** API models do not read the vault's AGENTS.md themselves (local agents do), so it is passed along. */
  private async vaultInstructions(): Promise<string | undefined> {
    const adapter = this.app.vault.adapter;
    if (!await adapter.exists("AGENTS.md")) return undefined;
    return (await adapter.read("AGENTS.md")).slice(0, 8_000);
  }
  /** Files named in the prompt ([[links]] or vault paths) are snapshotted so edits to them can be undone. */
  private async mentionedSnapshots(prompt: string, sourcePath: string): Promise<Map<string, string>> {
    const found = new Set<string>();
    for (const match of prompt.matchAll(/\[\[([^\]|#]+)/g)) {
      const file = this.app.metadataCache.getFirstLinkpathDest(match[1]!.trim(), sourcePath);
      if (file) found.add(file.path);
    }
    for (const match of prompt.matchAll(/[^\s"'“”「」《》()（），。；：]+\.(?:md|canvas|base|txt|json|csv)/gi)) {
      const file = this.app.vault.getAbstractFileByPath(normalizePath(match[0].replace(/^[./]+/, "")));
      if (file instanceof TFile) found.add(file.path);
    }
    const snapshots = new Map<string, string>();
    for (const path of [...found].slice(0, 20)) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile && file.stat.size <= 512 * 1024) snapshots.set(path, await this.app.vault.read(file));
    }
    return snapshots;
  }
  /** Shows the agent's questions as a card and waits until they are answered, skipped or the turn stops. */
  private readonly awaitAnswers = (request: QuestionRequest, signal: AbortSignal) => new Promise<QuestionAnswers | null>((resolve) => {
    if (signal.aborted) { resolve(null); return; }
    const done = (answers: QuestionAnswers | null) => { this.questions.delete(request.id); signal.removeEventListener("abort", cancel); resolve(answers); };
    const cancel = () => done(null);
    this.questions.set(request.id, done);
    signal.addEventListener("abort", cancel, { once: true });
    if (!this.containerEl.isShown()) new Notice("Agent 有问题需要你回答");
  });
  /** Tracks what an agent turn changes, routes ACP file access through the vault, and asks for approvals. */
  private turnHooks(snapshots: Map<string, string>): TurnHooks {
    const root = this.plugin.skillService.getVaultRoot();
    const tracker = new TurnChangeTracker(this.app, root, snapshots, externalFiles());
    tracker.start();
    const inVault = (path: string) => {
      const relative = toVaultPath(path, root);
      if (relative === null) throw new Error("只能访问当前库内的文件");
      return relative;
    };
    return {
      onFileIntent: (paths) => { for (const item of paths) if (item.read) tracker.observe(item.path); else tracker.intent(item.path, item.before, item.patch); },
      host: {
        readText: async (path) => this.app.vault.adapter.read(inVault(path)),
        writeText: async (path, content) => {
          const relative = inVault(path);
          const adapter = this.app.vault.adapter;
          const exists = await adapter.exists(relative);
          tracker.intent(relative, exists ? await adapter.read(relative) : null);
          const file = this.app.vault.getAbstractFileByPath(relative);
          if (file instanceof TFile) await this.app.vault.modify(file, content);
          else if (exists) await adapter.write(relative, content);
          else {
            const folder = relative.split("/").slice(0, -1).join("/");
            if (folder && !await adapter.exists(folder)) await this.app.vault.createFolder(folder);
            await this.app.vault.create(relative, content);
          }
        },
      },
      awaitApproval: (request, signal) => new Promise<string | null>((resolve) => {
        if (signal.aborted) { resolve(null); return; }
        const done = (choice: string | null) => { this.approvals.delete(request.id); signal.removeEventListener("abort", cancel); resolve(choice); };
        const cancel = () => done(null);
        this.approvals.set(request.id, done);
        signal.addEventListener("abort", cancel, { once: true });
        new Notice("Agent 正在等待你批准一个操作");
      }),
      awaitAnswers: this.awaitAnswers,
      finish: () => tracker.finish(),
      onLateChanges: (files) => this.attachLateChanges(files),
    };
  }
  /** A stopped turn's changes arrive after its stream closed; attach them to that reply. */
  private attachLateChanges(files: import("./types").FileChange[]): void {
    const messages = [...this.chat.messages];
    const index = messages.map((m) => m.role).lastIndexOf("assistant");
    if (index < 0) return;
    const message = messages[index]!;
    messages[index] = { ...message, parts: [...message.parts.filter((p) => p.type !== "data-changes"), { type: "data-changes", id: "changes", data: { files } }] };
    this.chat.messages = messages;
    void this.persist();
  }
  private openRevert(messageId: string): void {
    const message = this.chat.messages.find((m) => m.id === messageId);
    const part = message?.parts.find((p) => p.type === "data-changes");
    if (!message || !part || part.type !== "data-changes" || this.running()) return;
    new RevertDialog(this.app, part.data.files, (restored) => {
      if (!restored.length) return;
      const done = new Set(restored);
      this.chat.messages = this.chat.messages.map((m) => {
        if (m.id !== messageId) return m;
        return { ...m, parts: m.parts.map((p) => {
          if (p.type !== "data-changes") return p;
          const files = p.data.files.map((file) => done.has(file.path) ? { ...file, reverted: true } : file);
          const pending = files.some((file) => file.tracked && !file.binary && !file.outside && !file.reverted);
          return { ...p, data: { ...p.data, files, ...(pending ? {} : { revertedAt: Date.now() }) } };
        }) };
      });
      void this.persist();
    }).open();
  }
  private modelSources(): ModelSource[] {
    const settings = this.plugin.settings;
    const agents: ModelSource[] = this.plugin.backendService.getDetections().filter((d) => d.callable && agentShown(settings, d.id)).map((d) => {
      const key = `cli:${d.id}`;
      const cached = settings.agentModelCache[d.id]?.models;
      // Settings owns the catalog; a view-local copy would mask later refreshes.
      const models = cached ?? [];
      const state = this.sourceState.get(key) ?? {};
      return { key, kind: "agent", label: d.label, icon: agentIconKey(d.id), ...visibleAgentModels(settings, d.id, models), allowCustom: !Object.hasOwn(settings.agentEnabledModels, d.id), canListModels: Boolean(nativeTransportFor(d.id, d.nativePath) || d.id === "antigravity" || d.id === "pi"), loaded: Boolean(cached?.length), ...state };
    });
    const providers: ModelSource[] = settings.providers
      .filter((p) => p.showInPicker !== false && (Boolean(this.app.secretStorage.getSecret(p.secretId)) || permitsEmptyKey(p)))
      .map((p) => ({ key: `api:${p.id}`, kind: "api", label: providerLabel(p), icon: providerIcon(p), models: exposedModels(p), loaded: true, ...this.sourceState.get(`api:${p.id}`) }));
    return [...agents, ...providers];
  }
  private pickerSelection(): PickerSelection | null {
    let key = "";
    try { key = this.selectionKey(); } catch { return null; }
    const settings = this.plugin.settings;
    if (key.startsWith("cli:")) return { source: key, model: settings.modelSelections?.[key]?.model ?? "" };
    const provider = activeProvider(settings);
    return provider ? { source: `api:${provider.id}`, model: settings.modelSelections?.[key]?.model || settings.api.model } : null;
  }
  private pickModel(source: string, model: string): void {
    if (this.running()) return;
    try { chooseModel(this.plugin.settings, source, model); }
    catch (e) { new Notice(e instanceof Error ? e.message : String(e)); return; }
    this.plugin.backendService.resetSessions(this.backendOwner);
    void this.plugin.saveSettings();
  }
  private async loadSourceModels(source: string): Promise<void> {
    const settings = this.plugin.settings;
    if (this.sourceState.get(source)?.loading) return;
    this.sourceState.set(source, { loading: true }); this.render();
    try {
      if (source.startsWith("cli:")) {
        const backend = this.plugin.backendService.resolve(source, this.backendOwner);
        const request: ChatRequest = { prompt: "", systemPrompt: settings.systemPrompt, cwd: this.plugin.skillService.getVaultRoot(), permissionMode: settings.permissionMode, history: [], mcpConfig: enabledMcpConfig(settings.mcpConfig, settings.disabledMcpServers) };
        const models = await backend.listModels?.(request) ?? [];
        settings.agentModelCache[source.slice(4)] = { models: models.map(({ id, name, efforts }) => ({ id, name, efforts })), fetchedAt: Date.now() };
      } else {
        const provider = findProvider(settings, source.slice(4));
        if (!provider) throw new Error("该服务商已被移除");
        provider.models = await new ApiBackend(provider, this.app.secretStorage.getSecret(provider.secretId) ?? "", "", this.app).listModels();
        provider.fetchedAt = Date.now();
      }
      this.sourceState.delete(source);
      await this.plugin.saveSettings();
    } catch (e) {
      this.sourceState.set(source, { error: e instanceof Error ? e.message : "无法获取模型列表" });
    }
    this.render();
  }
  private openSkillMenu(event: MouseEvent): void {
    const menu = new Menu();
    const choose = (skill: AgentSkill | null) => { if (!this.running()) { this.selectedSkill = skill; this.render(); } };
    menu.addItem((item) => item.setTitle("不使用技能").setChecked(!this.selectedSkill).onClick(() => choose(null)));
    menu.addItem((item) => item.setTitle("选择技能…").setIcon("search").onClick(() => new CapabilitiesModal(this.app, this.plugin, "skills", choose).open()));
    menu.addItem((item) => item.setTitle("管理技能与工具连接…").setIcon("settings-2").onClick(() => new CapabilitiesModal(this.app, this.plugin).open()));
    menu.showAtMouseEvent(event);
  }
  private openHistory(event: MouseEvent): void {
    const menu = new Menu();
    const history = this.plugin.settings.conversations ?? [];
    if (!history.length) menu.addItem((item) => item.setTitle("暂无历史对话").setDisabled(true));
    for (const entry of history) menu.addItem((item) => item.setTitle(entry.title).setIcon(entry.fork ? "git-branch" : "messages-square")
      .onClick(() => this.openConversation(entry.id)));
    menu.showAtMouseEvent(event);
  }
  private resolveAttachment(attachment: ChatAttachment): ChatAttachment {
    return attachment.vaultPath
      ? { ...attachment, url: this.app.vault.adapter.getResourcePath(normalizePath(attachment.vaultPath)) }
      : attachment;
  }

  private async storeGeneratedAttachment(generated: GeneratedAttachment): Promise<ChatAttachment> {
    let bytes: Uint8Array;
    if (generated.base64) {
      const binary = atob(generated.base64);
      bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    } else if (generated.localPath) {
      const runtimeRequire = getRuntimeRequire();
      if (!runtimeRequire) throw new Error("本地生成文件仅能在桌面端导入");
      const fileSystem = runtimeRequire("fs/promises") as { readFile(path: string): Promise<Uint8Array> };
      const urlModule = runtimeRequire("url") as { fileURLToPath(url: string): string };
      const localPath = generated.localPath.startsWith("file:") ? urlModule.fileURLToPath(generated.localPath) : generated.localPath;
      bytes = await fileSystem.readFile(localPath);
    } else {
      throw new Error(`生成文件 ${generated.name} 没有可读取的内容`);
    }
    const root = normalizePath(".qiaomu-agent/generated-images");
    const adapter = this.app.vault.adapter;
    if (!await adapter.exists(".qiaomu-agent")) await adapter.mkdir(".qiaomu-agent");
    if (!await adapter.exists(root)) await adapter.mkdir(root);
    const safeName = generated.name.replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "") || "generated.png";
    const vaultPath = normalizePath(`${root}/${generated.id.replace(/[^a-zA-Z0-9_-]/g, "-")}-${safeName}`);
    const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    await adapter.writeBinary(vaultPath, data);
    return this.resolveAttachment({
      id: generated.id,
      name: safeName,
      mediaType: generated.mediaType,
      size: bytes.byteLength,
      vaultPath,
    });
  }
  refreshPalette(): void { applyChatTheme(this.contentEl, this.plugin.settings.chatTheme); }

  private render(): void {
    if (!this.root) return;
    this.refreshPalette();
    const appearance = this.plugin.settings;
    this.contentEl.style.setProperty("--qa-chat-font", chatFontStack(appearance.chatFontFamily, appearance.chatFontCustom));
    this.contentEl.style.setProperty("--qa-code-font", codeFontStack(appearance.codeFontFamily));
    this.contentEl.style.setProperty("--qa-chat-font-size", `${appearance.chatFontSize}px`);
    this.contentEl.style.setProperty("--qa-code-font-size", `${appearance.codeFontSize}px`);
    const file = this.plugin.getActiveMarkdownFile();
    const label = this.plugin.backendService.getBackendOptions().find((o) => o.value === this.selectedBackend)?.label.replace(/\s*·.*$/, "") || "选择模型";
    let key = ""; try { key = this.selectionKey(); } catch { /* connection can be unavailable */ }
    const selection = this.plugin.settings.modelSelections?.[key];
    const editorSelection = this.activeSelection();
    this.shownSelection = editorSelection ? this.editorSelectionKey(editorSelection) : "";
    this.highlightSelection(Boolean(editorSelection));
    const sources = this.modelSources();
    const picked = this.pickerSelection();
    const source = sources.find((item) => item.key === picked?.source);
    const catalog = key.startsWith("cli:") ? this.plugin.settings.agentModelCache[key.slice(4)]?.models : activeProvider(this.plugin.settings)?.models;
    const model = source?.models.find((m) => m.id === picked?.model) ?? catalog?.find((m) => m.id === picked?.model);
    const fullAccessAvailable = fullAccessFor(key.startsWith("api:") ? "api" : key);
    const permission = this.plugin.settings.permissionMode === "full" && !fullAccessAvailable ? "edit" : this.plugin.settings.permissionMode;
    this.root.render(createElement(ChatPanel, {
      chat: this.chat, app: this.app, parent: this,
      conversationId: activeIdentity(this.plugin.settings).id,
      imageTargetNote: file,
      conversationTitle: this.plugin.settings.activeConversation?.title ?? "",
      backendLabel: model?.name || picked?.model || (source ? source.label : sources.length ? label : "添加模型"), skillLabel: this.selectedSkill && !this.plugin.settings.disabledSkillPaths.includes(this.selectedSkill.path) ? this.selectedSkill.name : "技能",
      efforts: model?.efforts ?? (selection?.effort ? [selection.effort] : []), effort: selection?.effort ?? "", modelLoading: false,
      sources, selection: picked, recentModels: this.plugin.settings.recentModels,
      onPickModel: (sourceKey: string, modelId: string) => this.pickModel(sourceKey, modelId),
      onLoadModels: (sourceKey: string) => void this.loadSourceModels(sourceKey),
      onManageModels: () => new ModelManagerModal(this.app, this.plugin).open(),
      onEffort: (effort: string) => { if (this.running() || !selection) return; selection.effort = effort; this.plugin.backendService.resetSessions(this.backendOwner); void this.plugin.saveSettings(); this.render(); },
      promptCatalog: this.plugin.promptCatalog(), promptSettings: this.plugin.settings.prompts, promptRequest: this.promptRequest,
      onManagePrompts: (draft?: string) => new PromptLibraryModal(this.app, this.plugin.promptHost(), draft === undefined ? {} : { draft }).open(),
      onEditPrompt: (item: PromptItem) => new PromptLibraryModal(this.app, this.plugin.promptHost(), { item }).open(),
      onPromptUsed: (id: string) => void this.plugin.recordPromptUse(id),
      onTogglePromptPin: (item: PromptItem) => void this.plugin.togglePromptPin(item),
      onPickFile: (choose: (attachment: ChatAttachment) => void) => this.chooseFile(choose),
      onPickFolder: (choose: (attachment: ChatAttachment) => void) => this.chooseFolder(choose),
      onPickWebPage: getRuntimeRequire() ? (choose: (attachment: ChatAttachment) => void) => this.chooseWebPage(choose) : undefined,
      webSearch: this.webSearchAvailable(key) ? this.plugin.settings.webSearch !== false : undefined,
      onToggleWebSearch: () => { this.plugin.settings.webSearch = this.plugin.settings.webSearch === false; void this.plugin.saveSettings(); this.render(); },
      onValidateAttachments: (attachments: ChatAttachment[]) => {
        const backendId = this.plugin.backendService.resolve(this.selectedBackend, this.backendOwner).id;
        validateAttachments(attachments, backendId);
        const provider = backendId === "api" ? activeProvider(this.plugin.settings) : undefined;
        const modelId = this.plugin.settings.modelSelections?.[this.selectionKey()]?.model || this.plugin.settings.api.model;
        if (provider) checkImageInput(resolveModel(provider, modelId), attachments);
      },
      onAppend: (text: string, daily: boolean) => void this.append(text, daily),
      permission, fileAccessAvailable: true, fullAccessAvailable, note: this.attachNote ? file : null, detachedNote: this.attachNote ? null : file,
      statusText: this.statusText,
      prefill: this.prefill, prefillVersion: this.prefillVersion, submitVersion: this.submitVersion, focusVersion: this.focusVersion, addRequest: this.addRequest,
      addHotkeys: Object.fromEntries(Object.entries(ADD_COMMANDS).map(([kind, command]) => [kind, commandHotkey(this.app, this.plugin.manifest.id, command.id, Platform.isMacOS)])) as Record<AddKind, string>,
      onConnection: () => this.openConnection(), onNew: () => this.newConversation(), onOpenSettings: () => this.openSettings(),
      onHistory: (event: MouseEvent) => this.openHistory(event),
      branch: this.plugin.settings.activeConversation?.fork ?? null,
      onOpenParent: (id: string) => this.openConversation(id),
      onForkMessage: (id: string) => this.forkFromMessage(id),
      onSkill: (event: MouseEvent) => this.openSkillMenu(event),
      onEditMessage: () => this.plugin.backendService.resetSessions(this.backendOwner),
      onPermission: (mode: PermissionMode) => {
        if (this.running() || this.plugin.settings.permissionMode === mode) return;
        const apply = () => {
          this.plugin.settings.permissionMode = mode;
          this.plugin.backendService.resetSessions(this.backendOwner);
          void this.plugin.saveSettings(); this.render();
        };
        if (mode !== "full" || this.plugin.settings.fullAccessAcknowledged) { apply(); return; }
        new FullAccessDialog(this.app, () => { this.plugin.settings.fullAccessAcknowledged = true; apply(); }).open();
      },
      onToggleNote: () => { this.attachNote = !this.attachNote; this.render(); },
      editorSelection: editorSelection ? { label: `选中 ${editorSelection.endLine - editorSelection.startLine + 1} 行 · ${editorSelection.path.split("/").pop()?.replace(/\.md$/, "")}`, detail: editorSelection.text } : null,
      onDismissSelection: () => { const selection = this.activeSelection(); if (selection) { this.dismissedSelection = this.editorSelectionKey(selection); this.render(); } },
      reading: readingChip(this.plugin.reading.current()),
      onDismissReading: () => this.plugin.reading.dismiss(),
      onComposerFocus: () => this.render(),
      onApprove: (id: string, choice: string | null) => this.approvals.get(id)?.(choice),
      onAnswer: (id: string, answers: QuestionAnswers | null) => this.questions.get(id)?.(answers),
      onRevertChanges: (messageId: string) => this.openRevert(messageId),
      onOpenFile: (path: string) => { const file = this.app.vault.getAbstractFileByPath(path); if (file instanceof TFile) void this.app.workspace.getLeaf(false).openFile(file); },
      onPersist: () => this.persist(),
    }));
  }
}

/** Composer chip for the reading context; the tooltip shows where it comes from and a preview. */
function readingChip(snapshot: ContextSnapshot | null): ReadingChip | null {
  if (!snapshot) return null;
  const origin = [snapshot.sourceName, snapshot.title, snapshot.location].filter(Boolean).join(" · ");
  const preview = (snapshot.selection?.text ?? snapshot.text ?? "").slice(0, 400);
  return { label: readingLabel(snapshot), detail: preview ? `${origin}\n\n${preview}` : origin, kind: snapshot.kind, selected: Boolean(snapshot.selection) };
}

/** Codex enforces full access in its own sandbox; API models get it through the plugin's desktop tools. */
function fullAccessFor(backendId: string): boolean {
  return backendId === "cli:codex" || (backendId === "api" && Platform.isDesktopApp);
}
