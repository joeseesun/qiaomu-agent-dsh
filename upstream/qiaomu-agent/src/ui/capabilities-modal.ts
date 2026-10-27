import { renderPrivateHttpNotice } from "./private-http-notice";
import { App, Menu, Modal, Notice, Platform, setIcon } from "obsidian";
import type QiaomuAgentPlugin from "../main";
import { getRuntimeRequire } from "../services/runtime-require";
import { listMcpServers, readMcpConfig, removeMcpServer, saveMcpServer, type McpServerEntry } from "../services/mcp-config";
import { addCodexMcp, listCodexMcp } from "../services/codex-mcp";
import { parseSkillFrontmatter } from "../utils";
import type { AgentSkill } from "../types";
import { actionButton, hostSwitch, iconAction, labelField, sectionHead, wideField } from "./settings-kit";

type Tab = "skills" | "mcp";
type View = "list" | "add";

/** Folder picked through <input webkitdirectory>: the first file's absolute path minus its relative part. */
function pickedFolder(files: FileList | null): string | null {
  const file = files?.[0];
  if (!file?.webkitRelativePath) return null;
  const electron = getRuntimeRequire()?.("electron") as { webUtils?: { getPathForFile(file: File): string } } | undefined;
  const full = electron?.webUtils?.getPathForFile(file) || (file as File & { path?: string }).path;
  if (!full) return null;
  const inner = file.webkitRelativePath.split("/").slice(1).join("/");
  for (const suffix of [`/${inner}`, `\\${inner.replace(/\//g, "\\")}`]) if (full.endsWith(suffix)) return full.slice(0, -suffix.length);
  return null;
}

/**
 * Skills or tool connections, one page at a time: a list, and an "add" page that opens in place
 * with a back control in the title row. Tabs appear only when opened without a specific page.
 */
export class CapabilitiesModal extends Modal {
  private tab: Tab;
  private view: View = "list";
  private query = "";
  private confirmRemove = "";
  private readonly showTabs: boolean;

  constructor(app: App, private readonly plugin: QiaomuAgentPlugin, initialTab?: Tab, private readonly onSelectSkill?: (skill: AgentSkill) => void, private readonly onChange?: () => void) {
    super(app);
    this.tab = initialTab ?? "skills";
    this.showTabs = !initialTab && Platform.isDesktopApp;
  }

  override onOpen(): void {
    this.modalEl.addClass("qa-capabilities-modal");
    this.render();
  }
  override onClose(): void { this.contentEl.empty(); this.onChange?.(); }

  private get settings() { return this.plugin.settings; }

  private go(view: View): void { this.view = view; this.confirmRemove = ""; this.render(); }

  private render(): void {
    const adding = this.view === "add";
    this.titleEl.empty();
    this.titleEl.addClass("qa-modal-title");
    if (adding) iconAction(this.titleEl, "arrow-left", "返回", "qa-modal-back").addEventListener("click", () => this.go("list"));
    this.titleEl.createSpan({ cls: "qa-modal-title-text", text: adding ? (this.tab === "skills" ? "添加技能" : "添加工具连接") : this.showTabs ? "技能与工具连接" : this.tab === "skills" ? "技能" : "工具连接" });
    const el = this.contentEl;
    el.empty();
    const root = el.createDiv({ cls: "qa-models qa-cap" });
    if (this.showTabs && !adding) {
      const tabs = root.createDiv({ cls: "qa-capability-tabs", attr: { role: "tablist" } });
      for (const [id, label] of [["skills", "技能"], ["mcp", "工具连接"]] as const) {
        const selected = this.tab === id;
        const button = tabs.createEl("button", { text: label, attr: { type: "button", role: "tab", "aria-selected": String(selected), tabindex: selected ? "0" : "-1" } });
        button.addEventListener("click", () => { this.tab = id; this.go("list"); });
        button.addEventListener("keydown", (event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault(); this.tab = this.tab === "skills" ? "mcp" : "skills"; this.go("list");
          this.contentEl.querySelector<HTMLElement>("[role=tab][aria-selected=true]")?.focus();
        });
      }
    }
    if (this.tab === "skills") { if (adding) this.renderSkillAdd(root); else this.renderSkills(root); }
    else if (adding) this.renderMcpAdd(root);
    else this.renderMcp(root);
  }

  // Skills

  private renderSkills(el: HTMLElement): void {
    const section = el.createDiv({ cls: "qa-ms-section" });
    const toolbar = section.createDiv({ cls: "qa-cap-toolbar" });
    const searchLabel = toolbar.createEl("label", { cls: "qiaomu-agent__sr-only", text: "搜索技能" });
    const search = toolbar.createEl("input", { type: "search", cls: "qa-ms-input", attr: { placeholder: "搜索技能" } });
    search.id = `qa-skill-search-${crypto.randomUUID()}`;
    searchLabel.htmlFor = search.id;
    search.value = this.query;
    const refresh = iconAction(toolbar, "refresh-cw", "重新扫描技能目录");
    if (Platform.isDesktopApp) actionButton(toolbar, "plus", "添加").addEventListener("click", () => this.go("add"));
    const count = section.createDiv({ cls: "qa-cap-count" });
    const list = section.createDiv({ cls: "qa-ms-list qa-cap-list" });
    search.addEventListener("input", () => { this.query = search.value.trim().toLowerCase(); this.renderSkillRows(list, count); });
    refresh.addEventListener("click", async () => {
      refresh.disabled = true; refresh.addClass("is-busy");
      await this.plugin.skillService.refresh(this.settings.skillDirectories);
      this.renderSkillRows(list, count);
      refresh.disabled = false; refresh.removeClass("is-busy");
    });
    this.renderSkillRows(list, count);
    section.createDiv({ cls: "qa-ms-note", text: "开关决定技能是否出现在乔木的技能菜单里。Codex、Claude Code 等本机 Agent 仍会读取它们自己目录中的技能。" });
    if (!this.onSelectSkill) window.setTimeout(() => search.focus());
  }

  private renderSkillRows(list: HTMLElement, count: HTMLElement): void {
    list.empty();
    const all = this.plugin.skillService.list();
    const enabled = all.filter((skill) => !this.settings.disabledSkillPaths.includes(skill.path)).length;
    count.setText(all.length ? `已启用 ${enabled} / ${all.length}` : "");
    const skills = all.filter((skill) => `${skill.name} ${skill.description} ${skill.path}`.toLowerCase().includes(this.query));
    if (!skills.length) {
      list.createDiv({ cls: "qa-ms-list-empty", text: this.query ? "没有匹配的技能" : Platform.isDesktopApp ? "尚未发现技能。点“添加”导入本地技能，或点刷新重新扫描。" : "尚未发现技能。库内含 SKILL.md 的文件夹会自动出现在这里。" });
      return;
    }
    for (const [source, label] of [["vault", "库内技能"], ["external", "本机技能目录"]] as const) {
      const group = skills.filter((skill) => skill.source === source);
      if (!group.length) continue;
      list.createDiv({ cls: "qa-ms-list-label", text: `${label} · ${group.length}` });
      for (const skill of group) this.skillRow(list, count, skill);
    }
  }

  private skillRow(list: HTMLElement, count: HTMLElement, skill: AgentSkill): void {
    const shown = !this.settings.disabledSkillPaths.includes(skill.path);
    const row = list.createDiv({ cls: `qa-cap-row${shown ? "" : " is-off"}` });
    const copy = row.createDiv({ cls: "qa-cap-row-text" });
    copy.createDiv({ cls: "qa-ms-row-name", text: skill.name });
    if (skill.description) copy.createDiv({ cls: "qa-cap-row-desc", text: skill.description });
    if (this.onSelectSkill) {
      const choose = actionButton(row, "corner-down-left", "使用");
      choose.addEventListener("click", async () => {
        if (!shown) { this.settings.disabledSkillPaths = this.settings.disabledSkillPaths.filter((path) => path !== skill.path); await this.plugin.saveSettings(); }
        this.onSelectSkill?.(skill); this.close();
      });
    }
    hostSwitch(row.createDiv({ cls: "qa-ms-row-switch" }), shown, `在乔木中显示 ${skill.name}`, async (on) => {
      this.settings.disabledSkillPaths = on
        ? this.settings.disabledSkillPaths.filter((path) => path !== skill.path)
        : [...new Set([...this.settings.disabledSkillPaths, skill.path])];
      row.toggleClass("is-off", !on);
      await this.plugin.saveSettings();
      const all = this.plugin.skillService.list();
      count.setText(`已启用 ${all.filter((item) => !this.settings.disabledSkillPaths.includes(item.path)).length} / ${all.length}`);
    });
  }

  private renderSkillAdd(el: HTMLElement): void {
    const section = el.createDiv({ cls: "qa-ms-section" });
    sectionHead(section, "导入技能文件夹", "选择含 SKILL.md 的文件夹，它会被复制到个人技能目录。");
    const form = section.createDiv({ cls: "qa-ms-form" });
    const row = form.createDiv({ cls: "qa-cap-toolbar" });
    const pathLabel = row.createEl("label", { cls: "qiaomu-agent__sr-only", text: "技能文件夹的绝对路径" });
    const path = row.createEl("input", { type: "text", cls: "qa-ms-input is-mono", attr: { placeholder: "技能文件夹的绝对路径", spellcheck: "false" } });
    path.id = `qa-skill-path-${crypto.randomUUID()}`;
    pathLabel.htmlFor = path.id;
    const picker = form.createEl("input", { type: "file", attr: { webkitdirectory: "", hidden: "", "aria-hidden": "true", tabindex: "-1" } });
    actionButton(row, "folder-open", "选择…").addEventListener("click", () => picker.click());
    const error = form.createDiv({ cls: "qa-inline-error", attr: { role: "alert" } });
    picker.addEventListener("change", () => {
      const folder = pickedFolder(picker.files);
      if (folder) { path.value = folder; error.setText(""); }
      else error.setText("无法读取所选文件夹的路径，请直接粘贴路径。");
      picker.value = "";
    });
    const actions = form.createDiv({ cls: "qa-ms-form-actions" });
    const submit = actionButton(actions, "download", "导入", "is-primary");
    submit.addEventListener("click", async () => {
      submit.disabled = true; error.setText("");
      try {
        this.importLocalSkill(path.value);
        await this.plugin.skillService.refresh(this.settings.skillDirectories);
        new Notice("技能已加入个人技能目录");
        this.go("list");
      } catch (reason) { error.setText(reason instanceof Error ? reason.message : String(reason)); submit.disabled = false; }
    });

    const scan = el.createDiv({ cls: "qa-ms-section" });
    sectionHead(scan, "扫描其他目录", "每行一个绝对路径。只用于发现技能，不会移动文件。");
    const directoryLabel = scan.createEl("label", { cls: "qiaomu-agent__sr-only", text: "额外技能目录" });
    const directories = scan.createEl("textarea", { cls: "qa-ms-textarea is-mono", attr: { rows: "4", spellcheck: "false", placeholder: "/Users/me/skills" } });
    directories.id = `qa-skill-dirs-${crypto.randomUUID()}`;
    directoryLabel.htmlFor = directories.id;
    directories.value = this.settings.skillDirectories.join("\n");
    directories.addEventListener("change", async () => {
      this.settings.skillDirectories = directories.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      await this.plugin.saveSettings();
      await this.plugin.skillService.refresh(this.settings.skillDirectories);
    });
  }

  private importLocalSkill(input: string): void {
    const require = getRuntimeRequire();
    if (!require) throw new Error("仅桌面端可导入技能");
    const fs = require("fs") as typeof import("fs");
    const path = require("path") as typeof import("path");
    const source = path.resolve(input.trim());
    if (!input.trim() || !path.isAbsolute(input.trim()) || !fs.existsSync(source) || fs.lstatSync(source).isSymbolicLink() || !fs.statSync(source).isDirectory()) throw new Error("请选择有效的技能文件夹绝对路径");
    const manifest = path.join(source, "SKILL.md");
    if (!fs.existsSync(manifest) || !parseSkillFrontmatter(fs.readFileSync(manifest, "utf8"))) throw new Error("文件夹中需要有效的 SKILL.md");
    const base = path.basename(source);
    if (!/^[\p{L}\p{N}._-]+$/u.test(base) || base === "." || base === "..") throw new Error("技能文件夹名称包含不支持的字符");
    const destinationRoot = this.plugin.skillService.defaultDirectories()[0];
    if (!destinationRoot) throw new Error("无法确定个人技能目录");
    const destination = path.join(destinationRoot, base);
    if (destination === source || destination.startsWith(`${source}${path.sep}`)) throw new Error("技能已经位于个人技能目录中");
    if (fs.existsSync(destination)) throw new Error("个人技能目录中已有同名文件夹，请先检查现有内容");
    fs.mkdirSync(destinationRoot, { recursive: true });
    fs.cpSync(source, destination, { recursive: true, errorOnExist: true, force: false,
      filter: (entry) => !fs.lstatSync(entry).isSymbolicLink() });
  }

  // Tool connections (MCP)

  private codexPath(): string | undefined {
    return this.plugin.backendService.getDetections().find((agent) => agent.id === "codex" && agent.callable)?.path ?? undefined;
  }

  private renderMcp(el: HTMLElement): void {
    const codexPath = this.codexPath();
    const section = el.createDiv({ cls: "qa-ms-section" });
    const actions = sectionHead(section, "乔木连接", "传给 Claude Code、Gemini 等通过 ACP / CLI 运行的本机 Agent。API 模型不使用这些连接。");
    actionButton(actions, "plus", "添加连接").addEventListener("click", () => this.go("add"));
    let servers: McpServerEntry[] = [];
    let readError = "";
    try { servers = listMcpServers(this.settings.mcpConfig); }
    catch (error) { readError = error instanceof Error ? error.message : String(error); }
    if (readError) section.createDiv({ cls: "qa-inline-error", attr: { role: "alert" }, text: `配置无法读取：${readError}。可在下方“编辑 JSON 配置”中修正。` });
    else if (!servers.length) {
      const empty = section.createDiv({ cls: "qa-ms-empty" });
      empty.createDiv({ cls: "qa-ms-empty-title", text: "还没有工具连接" });
      empty.createDiv({ cls: "qa-ms-empty-text", text: "连接远程 MCP 地址或本机程序，让 Agent 使用外部服务。" });
    } else {
      const list = section.createDiv({ cls: "qa-ms-list qa-cap-list" });
      for (const server of servers) this.serverRow(list, server, codexPath);
    }

    if (codexPath) this.renderCodexConnections(el, codexPath);

    const advanced = el.createEl("details", { cls: "qiaomu-agent-settings__advanced-settings qa-cap-json" });
    const summary = advanced.createEl("summary", { cls: "qa-disclosure" });
    summary.createSpan({ text: "编辑 JSON 配置" });
    setIcon(summary.createSpan({ cls: "qa-disclosure-chevron", attr: { "aria-hidden": "true" } }), "chevron-right");
    if (readError) advanced.open = true;
    const form = advanced.createDiv({ cls: "qa-ms-form" });
    const configLabel = form.createEl("label", { cls: "qiaomu-agent__sr-only", text: "MCP JSON 配置" });
    const input = form.createEl("textarea", { cls: "qa-ms-textarea is-mono", attr: { rows: "10", spellcheck: "false" } });
    input.id = `qa-mcp-json-${crypto.randomUUID()}`;
    configLabel.htmlFor = input.id;
    input.value = this.settings.mcpConfig;
    const error = form.createDiv({ cls: "qa-inline-error", attr: { role: "alert" } });
    const save = actionButton(form.createDiv({ cls: "qa-ms-form-actions" }), "check", "验证并保存", "is-primary");
    save.addEventListener("click", async () => {
      try { listMcpServers(input.value); this.settings.mcpConfig = input.value; await this.plugin.saveSettings(); new Notice("配置已保存"); this.render(); }
      catch (reason) { error.setText(reason instanceof Error ? reason.message : String(reason)); }
    });
  }

  private serverRow(list: HTMLElement, server: McpServerEntry, codexPath?: string): void {
    const on = !this.settings.disabledMcpServers.includes(server.name);
    const row = list.createDiv({ cls: `qa-cap-row${on ? "" : " is-off"}` });
    setIcon(row.createSpan({ cls: "qa-ms-row-icon", attr: { "aria-hidden": "true" } }), server.kind === "http" ? "globe" : "terminal");
    const copy = row.createDiv({ cls: "qa-cap-row-text" });
    copy.createDiv({ cls: "qa-ms-row-name", text: server.name });
    copy.createDiv({ cls: "qa-cap-row-desc is-mono", text: `${server.kind === "http" ? "远程" : "本机程序"} · ${server.target}` });
    if (this.confirmRemove === server.name) {
      const confirm = row.createDiv({ cls: "qa-cap-confirm" });
      actionButton(confirm, "x", "取消").addEventListener("click", () => { this.confirmRemove = ""; this.render(); });
      const remove = actionButton(confirm, "trash-2", "移除", "is-danger-strong");
      remove.addEventListener("click", async () => {
        this.settings.mcpConfig = removeMcpServer(this.settings.mcpConfig, server.name);
        this.settings.disabledMcpServers = this.settings.disabledMcpServers.filter((name) => name !== server.name);
        this.confirmRemove = ""; await this.plugin.saveSettings(); this.render();
      });
      window.setTimeout(() => remove.focus());
      return;
    }
    const more = iconAction(row, "more-horizontal", `${server.name} 的更多操作`);
    more.addEventListener("click", () => {
      const menu = new Menu();
      if (codexPath) menu.addItem((item) => item.setTitle("加入 Codex").setIcon("copy-plus").onClick(() => void this.copyToCodex(codexPath, server)));
      menu.addItem((item) => item.setTitle("移除").setIcon("trash-2").setWarning(true).onClick(() => { this.confirmRemove = server.name; this.render(); }));
      const rect = more.getBoundingClientRect();
      menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
    });
    hostSwitch(row.createDiv({ cls: "qa-ms-row-switch" }), on, `启用 ${server.name}`, async (enabled) => {
      this.settings.disabledMcpServers = enabled
        ? this.settings.disabledMcpServers.filter((name) => name !== server.name)
        : [...new Set([...this.settings.disabledMcpServers, server.name])];
      row.toggleClass("is-off", !enabled);
      await this.plugin.saveSettings();
    });
  }

  private async copyToCodex(codexPath: string, server: McpServerEntry): Promise<void> {
    try {
      const config = readMcpConfig(this.settings.mcpConfig).mcpServers as Record<string, Record<string, unknown>>;
      const raw = config[server.name];
      const supported = server.kind === "http" ? ["url"] : ["command", "args"];
      if (!raw || Object.keys(raw).some((key) => !supported.includes(key))) throw new Error("此连接含认证或高级参数，请在 Codex 原生配置中添加");
      await addCodexMcp(codexPath, server);
      const ready = await this.plugin.backendService.refreshCodexMcp();
      this.render(); new Notice(ready ? "已加入 Codex 配置；下一次对话将重新连接" : "已加入 Codex 配置；当前回复结束后请重载插件");
    } catch (error) { new Notice(error instanceof Error ? error.message : String(error)); }
  }

  private renderCodexConnections(el: HTMLElement, executable: string): void {
    const section = el.createDiv({ cls: "qa-ms-section" });
    sectionHead(section, "Codex 连接", "由 Codex 全局管理，与其他 Codex 客户端共用。");
    const list = section.createDiv({ cls: "qa-ms-list" });
    const status = list.createDiv({ cls: "qa-ms-list-empty", text: "正在读取 Codex 连接…" });
    void listCodexMcp(executable).then((servers) => {
      if (!list.isConnected) return;
      status.remove();
      if (!servers.length) list.createDiv({ cls: "qa-ms-list-empty", text: "Codex 还没有连接" });
      for (const server of servers) {
        const row = list.createDiv({ cls: `qa-cap-row${server.enabled ? "" : " is-off"}` });
        setIcon(row.createSpan({ cls: "qa-ms-row-icon", attr: { "aria-hidden": "true" } }), "plug");
        row.createDiv({ cls: "qa-cap-row-text" }).createDiv({ cls: "qa-ms-row-name", text: server.name });
        row.createSpan({ cls: "qa-pill", text: server.enabled ? "已配置" : "已关闭" });
      }
    }).catch((error) => { if (list.isConnected) status.setText(`无法读取 Codex 连接：${error instanceof Error ? error.message : String(error)}`); });
  }

  private renderMcpAdd(el: HTMLElement): void {
    const codexPath = this.codexPath();
    const form = el.createDiv({ cls: "qa-ms-form" });
    let scope: "codex" | "qiaomu" = codexPath ? "codex" : "qiaomu";
    let kind: "http" | "stdio" = "http";
    const segments = <T extends string>(parent: HTMLElement, label: string, options: Array<[T, string]>, value: T, onPick: (value: T) => void) => {
      const group = parent.createDiv({ cls: "qa-segments", attr: { role: "radiogroup" } });
      labelField(parent, group);
      const buttons = options.map(([id, text]) => {
        const button = group.createEl("button", { text, attr: { type: "button", role: "radio", "aria-checked": String(id === value) } });
        button.addEventListener("click", () => { for (const other of buttons) other.setAttribute("aria-checked", String(other === button)); onPick(id); });
        return button;
      });
    };
    const kindField = wideField(form, "连接方式");
    const nameField = wideField(form, "名称", "英文字母开头，可含数字、- 和 _");
    const name = nameField.createEl("input", { type: "text", cls: "qa-ms-input", attr: { placeholder: "例如 notes-search", spellcheck: "false" } });
    labelField(nameField, name);
    const targetField = wideField(form, "地址");
    const target = targetField.createEl("input", { type: "text", cls: "qa-ms-input is-mono", attr: { placeholder: "https://example.com/mcp", spellcheck: "false" } });
    labelField(targetField, target);
    let allowPrivateHttp = false;
    const updateNotice = renderPrivateHttpNotice(form, () => kind === "http" ? target.value : "", () => allowPrivateHttp, value => { allowPrivateHttp = value; });
    target.addEventListener("input", () => { allowPrivateHttp = false; updateNotice(); });
    const argsField = wideField(form, "参数", "每行一个");
    const args = argsField.createEl("textarea", { cls: "qa-ms-textarea is-mono", attr: { rows: "3", spellcheck: "false" } });
    labelField(argsField, args);
    argsField.hide();
    segments(kindField, "连接方式", [["http", "远程地址"], ["stdio", "本机程序"]], kind, (value) => {
      kind = value;
      allowPrivateHttp = false; updateNotice();
      const remote = value === "http";
      targetField.querySelector(".qa-ms-wide-label")?.setText(remote ? "地址" : "命令");
      target.placeholder = remote ? "https://example.com/mcp" : "npx";
      argsField.toggle(!remote);
    });
    if (codexPath) segments(wideField(form, "保存到", "Codex 配置会在其他 Codex 客户端中共用"), "保存到", [["codex", "Codex（全局）"], ["qiaomu", "乔木（其他本机 Agent）"]], scope, (value) => { scope = value; });
    const error = form.createDiv({ cls: "qa-inline-error", attr: { role: "alert" } });
    const submit = actionButton(form.createDiv({ cls: "qa-ms-form-actions" }), "plus", "添加", "is-primary");
    submit.addEventListener("click", async () => {
      error.setText("");
      const entry: McpServerEntry = { name: name.value.trim(), kind, target: target.value.trim(), args: args.value.split(/\r?\n/).map((part) => part.trim()).filter(Boolean) };
      try {
        if (scope === "codex" && codexPath) {
          saveMcpServer("{}", entry, allowPrivateHttp); // Validate before changing Codex's global configuration.
          submit.disabled = true;
          try {
            await addCodexMcp(codexPath, entry);
            const ready = await this.plugin.backendService.refreshCodexMcp();
            new Notice(ready ? "已加入 Codex 配置；下一次对话将重新连接" : "已加入 Codex 配置；当前回复结束后请重载插件");
          } finally { submit.disabled = false; }
        } else {
          if (listMcpServers(this.settings.mcpConfig).some((item) => item.name === entry.name)) throw new Error("已有同名连接");
          this.settings.mcpConfig = saveMcpServer(this.settings.mcpConfig, entry, allowPrivateHttp);
          await this.plugin.saveSettings();
        }
        this.go("list");
      } catch (reason) { error.setText(reason instanceof Error ? reason.message : String(reason)); }
    });
    window.setTimeout(() => name.focus());
  }
}
