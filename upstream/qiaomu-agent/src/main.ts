import { UpdateNotes } from './update-notes';
import { UPDATE_ENTRIES } from './update-notes-release';
import { cancelAccountLogins } from "./services/provider-auth";
import { watchPaneDividers } from "./pane-dividers";
import { FuzzySuggestModal, MarkdownView, Menu, Notice, Platform, Plugin, TFile, WorkspaceLeaf, type Editor, type MarkdownFileInfo } from "obsidian";
import { ChatView, VIEW_TYPE_QIAOMU_AGENT } from "./chat-view";
import { DEFAULT_SETTINGS, normalizeSettings } from "./defaults";
import { BackendService } from "./services/backend-service";
import { discoverLocalClis } from "./services/cli-discovery";
import { SkillService } from "./services/skill-service";
import { ObsidianCliService } from "./services/obsidian-cli";
import { ADD_COMMANDS, type AddKind } from "./services/hotkeys";
import { QiaomuSettingTab } from "./settings-tab";
import type { QiaomuSettings } from "./types";
import { InlineEditModal } from "./ui/inline-edit-modal";
import { CapabilitiesModal } from "./ui/capabilities-modal";
import { ReadingContextService } from "./integrations/reading-context";
import { createAgentApi } from "./integrations/agent-api";
import { createHomeProvider } from "./integrations/home";
import { notifyHomeChanged, type HomeProvider } from "./integrations/qiaomu-home";
import type { AgentApi } from "./integrations/qiaomu-context";
import { PromptStore } from "./services/prompt-store";
import { byUsage, isEnabled, legacyPrompts, promptCatalog, SOURCE_NAMES, type PromptItem } from "./services/prompt-library";
import type { PromptHost } from "./ui/prompt-library-panel";

export default class QiaomuAgentPlugin extends Plugin {
  updateNotes!: UpdateNotes;
  override settings: QiaomuSettings = { ...DEFAULT_SETTINGS, api: { ...DEFAULT_SETTINGS.api } };
  backendService!: BackendService;
  skillService!: SkillService;
  obsidianCliService!: ObsidianCliService;
  /** What the user is reading in other plugins and views. */
  reading!: ReadingContextService;
  /** Found by other plugins at `app.plugins.plugins["qiaomu-agent"].api` (Qiaomu Context Protocol). */
  api!: AgentApi;
  /** Recent conversations and a "new conversation" action on Qiaomu Home (see integrations/qiaomu-home.ts). */
  qiaomuHome?: HomeProvider;
  /** The user's prompts, as Markdown files in the prompt folder. */
  promptStore!: PromptStore;
  private readonly promptCommands = new Set<string>();

  override async onload(): Promise<void> {
    watchPaneDividers(this);
    this.settings = normalizeSettings(await this.loadData());
    // A lone default connection is only kept as a provider when a key was actually saved for it.
    const api = this.settings.api;
    if (!this.settings.providers.some((p) => p.secretId === api.secretId) && this.app.secretStorage.getSecret(api.secretId)) {
      this.settings.providers.push({ ...api, id: this.settings.providers.some((p) => p.id === api.provider) ? `${api.provider}-legacy` : api.provider });
    }
    this.backendService = new BackendService(this.app, () => this.settings);
    this.skillService = new SkillService(this.app);
    this.obsidianCliService = new ObsidianCliService();
    this.promptStore = new PromptStore(this.app, () => this.settings.prompts.folder);
    this.promptStore.watch(this);
    this.promptStore.onChange(() => { this.registerPromptCommands(); this.eachView((view) => view.refreshControls()); });

    this.registerView(VIEW_TYPE_QIAOMU_AGENT, (leaf) => new ChatView(leaf, this));
    this.reading = this.addChild(new ReadingContextService(this.app, VIEW_TYPE_QIAOMU_AGENT, () => this.eachView((view) => view.refreshReading())));
    this.api = createAgentApi({
      pin: (snapshot) => this.reading.pin(snapshot),
      open: (prompt) => this.activateView(prompt, true),
      compose: async (prompt, submit) => {
        await this.activateView();
        this.firstView()?.compose(prompt, submit);
      },
    });
    this.qiaomuHome = createHomeProvider(this);
    this.updateNotes = new UpdateNotes(this, UPDATE_ENTRIES, () => 'zh');
    this.addSettingTab(new QiaomuSettingTab(this.app, this));

    this.addRibbonIcon("tree-deciduous", "打开乔木 Agent", () => void this.activateView());
    this.addCommand({
      id: "open-agent",
      name: "打开 Agent 对话",
      callback: () => void this.activateView(),
    });
    this.addCommand({
      id: "new-conversation",
      name: "新建 Agent 对话",
      callback: () => this.eachView((view) => view.newConversation()),
    });
    for (const [kind, command] of Object.entries(ADD_COMMANDS) as [AddKind, typeof ADD_COMMANDS[AddKind]][]) this.addCommand({
      id: command.id,
      name: command.name,
      callback: () => void this.activateView().then(() => this.eachView((view) => view.requestAdd(kind))),
    });
    this.addCommand({
      id: "manage-capabilities",
      name: "管理技能与工具连接",
      callback: () => new CapabilitiesModal(this.app, this).open(),
    });
    this.addCommand({
      id: "ask-about-selection",
      name: "询问选中的文本",
      editorCallback: (editor) => {
        const selection = editor.getSelection().trim();
        void this.activateView(selection ? `请分析这段内容：\n\n${selection}` : undefined);
      },
    });
    this.addCommand({
      id: "rewrite-selection-inline",
      name: "改写选中内容（预览后替换）",
      editorCheckCallback: (checking, editor, ctx) => {
        if (!editor.getSelection().trim() || !ctx.file) return false;
        if (!checking) this.openInlineEdit(editor, ctx);
        return true;
      },
    });
    this.registerEvent(this.app.workspace.on("editor-menu", (menu: Menu, editor, ctx) => {
      if (!editor.getSelection().trim() || !ctx.file) return;
      menu.addItem((item) => item.setTitle("用乔木 Agent 改写选中内容…").setIcon("pencil-line")
        .setSection("action").onClick(() => this.openInlineEdit(editor, ctx)));
    }));

    this.addCommand({
      id: "run-prompt",
      name: "运行 Prompt…",
      callback: () => new PromptPicker(this).open(),
    });
    this.registerPromptCommands();

    this.app.workspace.onLayoutReady(() => {
      void this.promptStore.load().then(() => this.migratePrompts());
      this.eachView((view) => void view.ensureReady());
      void this.refreshIntegrations();
    });
    this.registerEvent(
      this.app.workspace.on("layout-change", () => {
        this.eachView((view) => void view.ensureReady());
      })
    );
    // Focus back in a note: its own selection is visible again, so drop our mirror highlight.
    this.registerDomEvent(document, "focusin", (event) => {
      if ((event.target as HTMLElement | null)?.closest?.(".cm-editor")) (globalThis as unknown as { CSS?: { highlights?: Map<string, unknown> } }).CSS?.highlights?.delete("qiaomu-selection");
    });
    // CodeMirror changes the editor selection before the chat composer receives focus.
    this.registerDomEvent(document, "selectionchange", () => {
      this.eachView((view) => view.refreshSelection());
    });
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        this.eachView((view) => view.refreshControls());
      })
    );
    this.registerEvent(
      this.app.workspace.on("file-open", () => {
        this.eachView((view) => view.refreshControls());
      })
    );
  }

  override onunload(): void {
    cancelAccountLogins();
    void this.backendService?.shutdown();
  }

  async saveAppearance(): Promise<void> {
    this.eachView((view) => view.refreshPalette());
    await this.saveData(this.settings);
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    notifyHomeChanged(this.app, this.manifest.id);
    this.eachView((view) => view.refreshControls());
  }

  promptCatalog(): PromptItem[] { return promptCatalog(this.promptStore.prompts); }

  promptHost(): PromptHost {
    return { app: this.app, store: this.promptStore, settings: () => this.settings.prompts, catalog: () => this.promptCatalog(), saveSettings: () => this.savePromptSettings() };
  }

  async savePromptSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.registerPromptCommands();
    this.eachView((view) => view.refreshControls());
  }

  async recordPromptUse(id: string): Promise<void> {
    const usage = this.settings.prompts.usage;
    usage[id] = { count: (usage[id]?.count ?? 0) + 1, last: Date.now() };
    await this.savePromptSettings();
  }

  async togglePromptPin(item: PromptItem): Promise<void> {
    const prompts = this.settings.prompts;
    if (prompts.pinned.includes(item.id)) prompts.pinned = prompts.pinned.filter((id) => id !== item.id);
    else { prompts.pinned = [...prompts.pinned, item.id]; prompts.enabled[item.id] = true; }
    await this.savePromptSettings();
  }

  async runPrompt(id: string): Promise<void> {
    await this.activateView();
    this.firstView()?.requestPrompt(id);
  }

  /** Each enabled prompt is a palette command, so it can have a hotkey; turned-off ones hide themselves. */
  private registerPromptCommands(): void {
    for (const item of this.promptCatalog()) {
      if (this.promptCommands.has(item.id) || !isEnabled(item, this.settings.prompts)) continue;
      this.promptCommands.add(item.id);
      const id = item.id;
      this.addCommand({
        id: `prompt-${commandKey(id)}`,
        name: `运行 Prompt：${item.title}`,
        checkCallback: (checking) => {
          const current = this.promptCatalog().find((prompt) => prompt.id === id);
          if (!current || !isEnabled(current, this.settings.prompts)) return false;
          if (!checking) void this.runPrompt(id);
          return true;
        },
      });
    }
  }

  /** Before 0.5 prompts lived in settings; edited quick prompts and saved templates become files once. */
  private async migratePrompts(): Promise<void> {
    const settings = this.settings;
    if (settings.prompts.migrated) return;
    try {
      const legacy = legacyPrompts(settings.customPrompts, settings.quickPrompts);
      for (const { item, pinned } of legacy) {
        const saved = await this.promptStore.save({ ...item, source: "user" });
        if (pinned && !settings.prompts.pinned.includes(saved.id)) settings.prompts.pinned.push(saved.id);
      }
      delete settings.customPrompts; delete settings.quickPrompts;
      settings.prompts.migrated = true;
      await this.savePromptSettings();
      if (legacy.length) new Notice(`已把 ${legacy.length} 条自定义 Prompt 移到「${settings.prompts.folder}」`);
    } catch (error) {
      console.error("Qiaomu Agent: prompt migration failed", error);
    }
  }

  async refreshIntegrations(): Promise<void> {
    await Promise.all([
      discoverLocalClis().then((detections) => {
        this.backendService.setDetections(detections);
        this.eachView((view) => view.refreshControls());
      }),
      this.skillService.refresh(this.settings.skillDirectories).then((skills) => {
        if (skills.length > 0) console.debug(`Qiaomu Agent: loaded ${skills.length} skills`);
        this.eachView((view) => view.refreshControls());
      }),
      this.obsidianCliService.detect(),
    ]);
  }

  async activateView(prefill?: string, focus = false): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_QIAOMU_AGENT)[0];
    if (!leaf) {
      leaf = Platform.isDesktopApp ? this.app.workspace.getRightLeaf(false) ?? undefined : this.app.workspace.getLeaf("tab");
      await leaf?.setViewState({ type: VIEW_TYPE_QIAOMU_AGENT, active: true });
    }
    if (!leaf) {
      new Notice("无法创建乔木 Agent 侧边栏");
      return;
    }
    await this.app.workspace.revealLeaf(leaf);
    const view = leaf.view;
    if (view instanceof ChatView) {
      await view.ensureReady();
      if (prefill) view.setComposer(prefill);
      else if (focus) view.focusComposer();
    }
  }

  private openInlineEdit(editor: Editor, ctx: MarkdownView | MarkdownFileInfo): void {
    const original = editor.getSelection();
    if (!original.trim() || !ctx.file) { new Notice("请先在笔记中选中要改写的文字"); return; }
    new InlineEditModal(this.app, this, {
      editor, path: ctx.file.path, from: editor.getCursor("from"), to: editor.getCursor("to"),
      original, document: editor.getValue(),
    }).open();
  }

  /**
   * The note on screen in the main area. When the main area shows something else (an article, a PDF,
   * a web page), no note is being looked at, so none is returned rather than an older one.
   */
  getActiveMarkdownFile(): TFile | null {
    const leaf = this.app.workspace.getMostRecentLeaf(this.app.workspace.rootSplit);
    return leaf?.view instanceof MarkdownView && leaf.view.file?.extension === "md" ? leaf.view.file : null;
  }

  firstView(): ChatView | null {
    const view = this.app.workspace.getLeavesOfType(VIEW_TYPE_QIAOMU_AGENT)[0]?.view;
    return view instanceof ChatView ? view : null;
  }

  private eachView(callback: (view: ChatView) => void): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_QIAOMU_AGENT)) {
      if (leaf.view instanceof ChatView) callback(leaf.view);
    }
  }
}

/** A short stable command id for any prompt id (built-in slugs, uuids or file paths). */
function commandKey(id: string): string {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  return `${id.replace(/[^a-z0-9-]+/gi, "-").slice(0, 40)}-${(hash >>> 0).toString(36)}`;
}

/** 运行 Prompt…: every enabled prompt, most used first. */
class PromptPicker extends FuzzySuggestModal<PromptItem> {
  constructor(private readonly plugin: QiaomuAgentPlugin) {
    super(plugin.app);
    this.setPlaceholder("运行哪个 Prompt？");
  }
  getItems(): PromptItem[] {
    return byUsage(this.plugin.promptCatalog().filter((item) => isEnabled(item, this.plugin.settings.prompts)), this.plugin.settings.prompts);
  }
  getItemText(item: PromptItem): string { return `${item.title}  ·  ${item.category ?? SOURCE_NAMES[item.source]}`; }
  onChooseItem(item: PromptItem): void { void this.plugin.runPrompt(item.id); }
}
