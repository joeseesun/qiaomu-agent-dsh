import { Menu, Modal, Notice, Setting, type App } from "obsidian";
import {
  builtinPrompt, exportPrompts, importablePrompts, isEnabled, LIBRARY_FROM, matchesPrompt, SOURCE_NAMES,
  type PromptItem, type PromptSettings, type PromptSource,
} from "../services/prompt-library";
import { promptFields } from "../services/prompt-template";
import type { PromptStore } from "../services/prompt-store";
import { actionButton, hostSwitch, iconAction, labelField, sectionHead, wideField } from "./settings-kit";

/** What the library page needs from the plugin. */
export interface PromptHost {
  app: App;
  store: PromptStore;
  settings(): PromptSettings;
  catalog(): PromptItem[];
  /** Persists prompt settings and refreshes open chats. */
  saveSettings(): Promise<void>;
}

type Tab = "enabled" | "all" | PromptSource;
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "enabled", label: "已启用" }, { id: "all", label: "全部" }, { id: "user", label: "我的" },
  { id: "scene", label: "场景" }, { id: "qiaomu", label: "乔木精选" }, { id: "yao", label: "Yao Open Prompts" },
];

/**
 * The prompt library: turn built-in prompts on, pin them to the chat strip, write and edit your own.
 * Used as the settings "Prompt" tab and, from the chat, inside a modal.
 */
export class PromptLibraryPanel {
  private tab: Tab = "enabled";
  private query = "";
  private category = "";
  private editing: { item: PromptItem; isNew: boolean } | null = null;
  private readonly unsubscribe: () => void;

  /** `onDone` closes a modal opened just to write or edit one prompt; `dismiss` closes it before opening a file. */
  constructor(private readonly host: PromptHost, private readonly container: HTMLElement, private readonly onDone?: () => void, private readonly dismiss?: () => void) {
    this.unsubscribe = host.store.onChange(() => { if (!this.editing) this.render(); });
  }

  destroy(): void { this.unsubscribe(); this.container.empty(); }

  /** Opens the editor: an existing prompt, or a new one starting from `draft`. */
  edit(item?: PromptItem, draft = ""): void {
    this.editing = item ? { item, isNew: false } : { item: { id: crypto.randomUUID(), title: "", body: draft, source: "user" }, isNew: true };
    this.render();
  }

  render(): void {
    this.container.empty();
    this.container.addClass("qa-prompt-library");
    if (this.editing) this.renderEditor(this.editing.item, this.editing.isNew);
    else this.renderList();
  }

  private get settings() { return this.host.settings(); }

  private async setEnabled(item: PromptItem, value: boolean): Promise<void> {
    const settings = this.settings;
    settings.enabled[item.id] = value;
    if (!value) settings.pinned = settings.pinned.filter((id) => id !== item.id);
    await this.host.saveSettings();
  }

  private async togglePin(item: PromptItem): Promise<void> {
    const settings = this.settings;
    if (settings.pinned.includes(item.id)) settings.pinned = settings.pinned.filter((id) => id !== item.id);
    else { settings.pinned = [...settings.pinned, item.id]; settings.enabled[item.id] = true; }
    await this.host.saveSettings();
  }

  private renderList(): void {
    const catalog = this.host.catalog();
    const settings = this.settings;
    const actions = sectionHead(this.container, "Prompt 库", "点快捷条上的 Prompt 会直接发送，需要补充信息时先问你。内置库默认不启用，打开需要的即可。");
    actionButton(actions, "plus", "新建", "is-primary").addEventListener("click", () => this.edit());
    const more = iconAction(actions, "more-horizontal", "导入与导出");
    more.addEventListener("click", (event) => {
      const menu = new Menu();
      menu.addItem((entry) => entry.setTitle("导入 JSON…").setIcon("download").onClick(() => this.importJson()));
      menu.addItem((entry) => entry.setTitle("复制我的 Prompt 为 JSON").setIcon("copy").onClick(() => this.exportJson()));
      menu.showAtMouseEvent(event);
    });

    const inTab = (item: PromptItem) => this.tab === "enabled" ? isEnabled(item, settings) : this.tab === "all" || item.source === this.tab;
    const tabs = this.container.createDiv({ cls: "qa-prompt-tabs", attr: { role: "tablist", "aria-label": "Prompt 来源" } });
    for (const tab of TABS) {
      const count = catalog.filter((item) => tab.id === "enabled" ? isEnabled(item, settings) : tab.id === "all" || item.source === tab.id).length;
      if (tab.id === "user" && !count && this.tab !== "user") continue;
      const button = tabs.createEl("button", { cls: "qa-prompt-tab", attr: { type: "button", role: "tab", "aria-selected": String(this.tab === tab.id) } });
      button.createSpan({ text: tab.label }); button.createSpan({ cls: "qa-prompt-tab-count", text: String(count) });
      if (this.tab === tab.id) button.addClass("is-active");
      button.addEventListener("click", () => { this.tab = tab.id; this.category = ""; this.render(); });
    }

    const scoped = catalog.filter(inTab);
    const tools = this.container.createDiv({ cls: "qa-prompt-tools" });
    const search = tools.createEl("input", { cls: "qa-ms-input", type: "search", attr: { placeholder: "搜索名称、正文、分类", "aria-label": "搜索 Prompt" } });
    search.value = this.query;
    const categories = [...new Set(scoped.map((item) => item.category).filter((c): c is string => Boolean(c)))];
    if (categories.length > 1) {
      const select = tools.createEl("select", { cls: "dropdown", attr: { "aria-label": "分类" } });
      select.createEl("option", { text: "全部分类", value: "" });
      for (const category of categories) select.createEl("option", { text: category, value: category });
      select.value = categories.includes(this.category) ? this.category : "";
      select.addEventListener("change", () => { this.category = select.value; drawRows(); });
    }
    const list = this.container.createDiv({ cls: "qa-ms-list qa-prompt-rows" });
    const drawRows = () => {
      list.empty();
      const rows = scoped.filter((item) => (!this.category || item.category === this.category) && matchesPrompt(item, this.query));
      for (const item of rows) this.renderRow(list, item);
      if (!rows.length) list.createDiv({ cls: "qa-prompt-empty", text: this.tab === "enabled" && !this.query ? "还没有启用的 Prompt。到「全部」里打开需要的。" : "没有匹配的 Prompt" });
    };
    search.addEventListener("input", () => { this.query = search.value; drawRows(); });
    drawRows();

    const foot = this.container.createDiv({ cls: "qa-prompt-foot" });
    foot.createDiv({ text: `你的 Prompt 保存在库里的「${settings.folder}」文件夹，每条一个 Markdown 文件，可以直接在 Obsidian 里编辑。` });
    const credit = foot.createDiv();
    credit.appendText("内置库来自 ");
    credit.createEl("a", { text: "Qiaomu-QuickPrompt", href: "https://github.com/joeseesun/Qiaomu-QuickPrompt", attr: { target: "_blank", rel: "noopener noreferrer", title: LIBRARY_FROM } });
    credit.appendText("；Yao Open Prompts 作者姚金刚，以 ");
    credit.createEl("a", { text: "CC BY 4.0", href: "https://creativecommons.org/licenses/by/4.0/", attr: { target: "_blank", rel: "noopener noreferrer" } });
    credit.appendText(" 许可使用。");
  }

  private renderRow(list: HTMLElement, item: PromptItem): void {
    const settings = this.settings;
    const enabled = isEnabled(item, settings);
    const pinned = settings.pinned.includes(item.id);
    const row = list.createDiv({ cls: `qa-ms-row qa-prompt-row${enabled ? "" : " is-off"}` });
    hostSwitch(row.createDiv({ cls: "qa-ms-row-switch" }), enabled, `启用「${item.title}」`, (value) => void this.setEnabled(item, value));
    const main = row.createEl("button", { cls: "qa-ms-row-main", attr: { type: "button" } });
    const text = main.createDiv({ cls: "qa-ms-row-text" });
    text.createDiv({ cls: "qa-ms-row-name", text: item.title });
    const uses = settings.usage[item.id]?.count;
    const meta = [SOURCE_NAMES[item.source], item.category, item.overrides ? "已改写" : "", promptFields(item.body).length ? "运行前填空" : "",
      item.run === "insert" ? "填入输入框" : "", uses ? `用过 ${uses} 次` : ""].filter(Boolean).join(" · ");
    text.createDiv({ cls: "qa-ms-row-sub", text: meta });
    main.addEventListener("click", () => this.edit(item));
    const pin = iconAction(row, pinned ? "pin-off" : "pin", pinned ? `从快捷条移除「${item.title}」` : `固定「${item.title}」到快捷条`, pinned ? "is-active" : "");
    pin.addEventListener("click", () => void this.togglePin(item));
    const more = iconAction(row, "more-horizontal", `「${item.title}」的更多操作`);
    more.addEventListener("click", (event) => {
      const menu = new Menu();
      menu.addItem((entry) => entry.setTitle("编辑").setIcon("pencil").onClick(() => this.edit(item)));
      menu.addItem((entry) => entry.setTitle("复制为我的 Prompt").setIcon("copy").onClick(() =>
        this.edit({ id: crypto.randomUUID(), title: `${item.title} 副本`, body: item.body, category: item.category, tags: item.tags, run: item.run, source: "user" }, "")));
      const file = this.host.store.file(item);
      if (file) menu.addItem((entry) => entry.setTitle("在 Obsidian 中打开").setIcon("file-text").onClick(() => { void this.host.app.workspace.getLeaf("tab").openFile(file); this.dismiss?.(); }));
      if (item.url) menu.addItem((entry) => entry.setTitle("查看来源").setIcon("external-link").onClick(() => window.open(item.url, "_blank", "noopener")));
      if (item.overrides) menu.addItem((entry) => entry.setTitle("恢复默认").setIcon("rotate-ccw").onClick(() => void this.reset(item)));
      if (item.source === "user") menu.addItem((entry) => entry.setTitle("删除").setIcon("trash-2").setWarning(true).onClick(() => this.confirmDelete(item)));
      menu.showAtMouseEvent(event);
    });
  }

  private renderEditor(item: PromptItem, isNew: boolean): void {
    const settings = this.settings;
    const builtin = item.source !== "user" && !item.overrides;
    const top = this.container.createDiv({ cls: "qa-prompt-editor-top" });
    actionButton(top, "arrow-left", "Prompt 库", "is-quiet").addEventListener("click", () => { this.editing = null; this.render(); });
    top.createEl("h3", { text: isNew ? "新建 Prompt" : builtin ? "查看内置 Prompt" : "编辑 Prompt" });
    if (builtin) this.container.createEl("p", { cls: "qa-prompt-note", text: `这是内置 Prompt（${SOURCE_NAMES[item.source]}）。修改后会在「${settings.folder}」保存一份你的版本，随时可以恢复默认。` });

    const form = this.container.createDiv({ cls: "qa-ms-list qa-ms-wide-list qa-ms-settings qa-prompt-form-fields" });
    const titleField = wideField(form, "名称");
    const title = titleField.createEl("input", { cls: "qa-ms-input", type: "text", attr: { placeholder: "例如 周报整理" } });
    title.value = item.title; labelField(titleField, title);
    const metaRow = form.createDiv({ cls: "qa-prompt-meta-fields" });
    const categoryField = wideField(metaRow, "分类");
    const category = categoryField.createEl("input", { cls: "qa-ms-input", type: "text", attr: { placeholder: "可选", list: "qa-prompt-categories" } });
    category.value = item.category ?? ""; labelField(categoryField, category);
    const datalist = categoryField.createEl("datalist"); datalist.id = "qa-prompt-categories";
    for (const name of new Set(this.host.catalog().map((p) => p.category).filter(Boolean))) datalist.createEl("option", { value: name! });
    const tagField = wideField(metaRow, "标签");
    const tags = tagField.createEl("input", { cls: "qa-ms-input", type: "text", attr: { placeholder: "可选，用逗号分隔" } });
    tags.value = (item.tags ?? []).join(", "); labelField(tagField, tags);
    let run = item.run ?? "send";
    new Setting(form).setName("点击后").setDesc("直接发送时，输入框里已有的文字会一起发出。")
      .addDropdown((dropdown) => dropdown.addOptions({ send: "直接发送", insert: "填入输入框，改好再发" }).setValue(run).onChange((value) => { run = value === "insert" ? "insert" : "send"; }));
    const bodyField = wideField(form, "Prompt", "用 {{名称}} 标出运行前要填的空，{{名称|默认值}} 带默认值");
    const body = bodyField.createEl("textarea", { cls: "qa-ms-textarea qa-prompt-body", attr: { rows: "14", spellcheck: "false" } });
    body.value = item.body; labelField(bodyField, body);
    const hint = bodyField.createDiv({ cls: "qa-prompt-hint", attr: { "aria-live": "polite" } });
    const updateHint = () => {
      const fields = promptFields(body.value, { selection: "x", clipboard: "x" }).map((field) => field.name);
      hint.setText(fields.length ? `运行前会先问：${fields.join("、")}` : "点击后直接发送，会带上当前笔记、选中文字或正在读的内容。");
    };
    body.addEventListener("input", updateHint); updateHint();
    const help = bodyField.createEl("details", { cls: "qa-prompt-help" });
    help.createEl("summary", { text: "可以用的占位符" });
    const table = help.createEl("ul");
    for (const [code, meaning] of [["{{主题}}", "运行前让你填写"], ["{{语气|轻松}}", "带默认值的空"], ['{argument name="语气" options="轻松, 正式"}', "从几个选项里选（兼容 Raycast）"],
      ["{selection}", "选中的文字；没有选中时会问你"], ["{note}", "当前笔记的名称（笔记内容会自动附带）"], ["{reading}", "正在阅读的内容"], ["{clipboard}", "剪贴板里的文字"], ["{date} {time} {day}", "今天的日期、时间、星期"]]) {
      const li = table.createEl("li"); li.createEl("code", { text: code }); li.appendText(` ${meaning}`);
    }

    const buttons = this.container.createDiv({ cls: "qa-prompt-editor-actions" });
    if (item.overrides) actionButton(buttons, "rotate-ccw", "恢复默认", "is-quiet").addEventListener("click", () => void this.reset(item));
    if (item.source === "user" && !isNew) actionButton(buttons, "trash-2", "删除", "is-danger").addEventListener("click", () => this.confirmDelete(item));
    buttons.createDiv({ cls: "qa-prompt-editor-spacer" });
    actionButton(buttons, "x", "取消", "is-quiet").addEventListener("click", () => { this.editing = null; if (isNew && this.onDone) this.onDone(); else this.render(); });
    const save = actionButton(buttons, "check", builtin ? "保存我的版本" : "保存", "is-primary");
    save.addEventListener("click", async () => {
      const next: PromptItem = {
        ...item, title: title.value.trim(), body: body.value.trim(), run,
        category: category.value.trim() || undefined,
        tags: tags.value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean),
      };
      if (!next.title || !next.body) { new Notice("请填写名称和 Prompt"); (next.title ? body : title).focus(); return; }
      save.disabled = true;
      try {
        await this.host.store.save(next);
        if (isNew || builtin) { settings.enabled[next.id] = true; await this.host.saveSettings(); }
        new Notice(isNew ? `已保存到「${settings.folder}」` : "已保存");
        this.editing = null;
        if (isNew && this.onDone) this.onDone(); else this.render();
      } catch (error) {
        save.disabled = false;
        new Notice(`保存失败：${error instanceof Error ? error.message : String(error)}`);
      }
    });
    window.setTimeout(() => (isNew && !item.body ? title : isNew ? title : body).focus());
  }

  private async reset(item: PromptItem): Promise<void> {
    await this.host.store.remove(item);
    new Notice(`已恢复「${builtinPrompt(item.id)?.title ?? item.title}」的默认内容`);
    this.editing = null; this.render();
  }

  private confirmDelete(item: PromptItem): void {
    const confirm = new Modal(this.host.app);
    confirm.titleEl.setText(`删除「${item.title}」？`);
    confirm.contentEl.createEl("p", { text: "文件会移到回收站，可以从那里恢复。" });
    new Setting(confirm.contentEl)
      .addButton((cancel) => cancel.setButtonText("取消").onClick(() => confirm.close()))
      .addButton((remove) => remove.setButtonText("删除").setWarning().onClick(async () => {
        remove.setDisabled(true);
        try {
          await this.host.store.remove(item);
          const settings = this.settings;
          settings.pinned = settings.pinned.filter((id) => id !== item.id);
          delete settings.enabled[item.id]; delete settings.usage[item.id];
          await this.host.saveSettings();
          confirm.close(); this.editing = null; this.render();
        } catch { new Notice("删除失败，请重试"); remove.setDisabled(false); }
      }));
    confirm.open();
  }

  private importJson(): void {
    const input = document.createElement("input");
    input.type = "file"; input.accept = ".json,application/json";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const prompts = importablePrompts(JSON.parse(await file.text()));
        if (!prompts.length) { new Notice("这个文件里没有可导入的 Prompt"); return; }
        const settings = this.settings;
        for (const prompt of prompts) {
          const saved = await this.host.store.save({ ...prompt, id: crypto.randomUUID(), source: "user" });
          settings.enabled[saved.id] = true;
        }
        await this.host.saveSettings();
        this.tab = "user"; this.render();
        new Notice(`已导入 ${prompts.length} 条 Prompt，保存在「${settings.folder}」`);
      } catch (error) {
        new Notice(`导入失败：${error instanceof Error ? error.message : String(error)}`);
      }
    });
    input.click();
  }

  private exportJson(): void {
    const own = this.host.catalog().filter((item) => item.source === "user" || item.overrides);
    if (!own.length) { new Notice("还没有你自己的 Prompt"); return; }
    void navigator.clipboard.writeText(exportPrompts(own))
      .then(() => new Notice(`已复制 ${own.length} 条 Prompt 的 JSON，可导入 Qiaomu-QuickPrompt 或其他设备`))
      .catch(() => new Notice("复制失败，请重试"));
  }
}

/** The library opened from the chat; `draft` starts a new prompt from the composer text. */
export class PromptLibraryModal extends Modal {
  private panel: PromptLibraryPanel | null = null;
  constructor(app: App, private readonly host: PromptHost, private readonly start: { draft?: string; item?: PromptItem } = {}) { super(app); }
  override onOpen(): void {
    this.modalEl.addClass("qa-prompt-library-modal", "qa-models");
    this.titleEl.setText("Prompt 库");
    this.panel = new PromptLibraryPanel(this.host, this.contentEl, this.start.draft !== undefined || this.start.item ? () => this.close() : undefined, () => this.close());
    if (this.start.item) this.panel.edit(this.start.item);
    else if (this.start.draft !== undefined) this.panel.edit(undefined, this.start.draft);
    else this.panel.render();
  }
  override onClose(): void { this.panel?.destroy(); this.panel = null; }
}
