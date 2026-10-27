import { App, Modal, Notice, Platform, PluginSettingTab, Setting, setIcon } from "obsidian";
import type QiaomuAgentPlugin from "./main";
import { ProviderSettings } from "./ui/provider-settings";
import { CapabilitiesModal } from "./ui/capabilities-modal";
import { searchWeb, WEB_SEARCH_SECRET_ID } from "./services/web-search";
import { applyChatTheme, CHAT_THEMES, normalizeChatTheme } from "./services/palettes";
import { availableFonts, chatFontStack, cleanFamily, codeFontStack, type FontChoice } from "./services/fonts";
import { listMcpServers } from "./services/mcp-config";
import { DEFAULT_SYSTEM_PROMPT } from "./defaults";
import { cleanFolder, DEFAULT_PROMPT_FOLDER } from "./services/prompt-library";
import { PromptLibraryPanel } from "./ui/prompt-library-panel";
import { FullAccessDialog } from "./ui/host-dialogs";
import { actionButton, iconAction, labelField, navRow, sectionHead, switchRow, wideField } from "./ui/settings-kit";
import type { PermissionMode } from "./types";

/** First real family in a CSS font-family stack ("??" is Obsidian's empty-override placeholder). */
function firstFamily(stack: string): string {
  for (const part of stack.split(",")) {
    const name = part.trim().replace(/^["']|["']$/g, "");
    if (name && name !== "??" && !name.startsWith("var(") && !/^-apple-system$|^BlinkMacSystemFont$|^system-ui$/i.test(name)) return name;
  }
  return "";
}

class WebSearchModal extends Modal {
  constructor(app: App, private readonly onChange: () => void) { super(app); }
  override onOpen(): void {
    this.modalEl.addClass("qa-web-search-modal");
    this.titleEl.setText("联网搜索");
    const connected = Boolean(this.app.secretStorage.getSecret(WEB_SEARCH_SECRET_ID));
    this.contentEl.createDiv({ cls: "qa-web-search-note", text: "模型自带搜索会自动使用。其他模型可连接 Brave Search。" });
    const label = this.contentEl.createEl("label", { cls: "qa-web-search-label", text: "Brave Search API Key" });
    const input = label.createEl("input", { type: "password", attr: { placeholder: connected ? "已保存 · 填写以更换" : "粘贴 API Key", autocomplete: "off", spellcheck: "false" } });
    const link = this.contentEl.createEl("a", { cls: "qa-web-search-link", text: "获取密钥", href: "https://api-dashboard.search.brave.com/", attr: { target: "_blank", rel: "noopener noreferrer" } });
    setIcon(link.createSpan({ attr: { "aria-hidden": "true" } }), "arrow-up-right");
    const footer = this.contentEl.createDiv({ cls: "qa-modal-footer" });
    if (connected) footer.createEl("button", { text: "移除密钥" }).addEventListener("click", () => {
      this.app.secretStorage.setSecret(WEB_SEARCH_SECRET_ID, ""); this.onChange(); this.close();
    });
    const save = footer.createEl("button", { cls: "mod-cta", text: "验证并保存" });
    save.addEventListener("click", async () => {
      const key = input.value.trim();
      if (!key) { if (!connected) new Notice("请填写 API Key"); else this.close(); return; }
      save.disabled = true; save.setText("验证中…");
      try {
        await searchWeb("Brave Search", key, AbortSignal.timeout(12_000));
        this.app.secretStorage.setSecret(WEB_SEARCH_SECRET_ID, key); this.onChange(); this.close();
      } catch (error) {
        new Notice(`连接失败：${error instanceof Error ? error.message : String(error)}`);
        save.disabled = false; save.setText("验证并保存");
      }
    });
  }
}

export class ModelManagerModal extends Modal {
  constructor(app: App, private readonly plugin: QiaomuAgentPlugin) { super(app); }
  override onOpen(): void {
    this.modalEl.addClass("qa-model-manager-modal");
    this.titleEl.setText("模型");
    const tab = new QiaomuSettingTab(this.app, this.plugin, true);
    tab.containerEl = this.contentEl;
    tab.display();
  }
  override onClose(): void { this.contentEl.empty(); }
}

export class QiaomuSettingTab extends PluginSettingTab {
  private activeSection: "models" | "chat" | "prompts" | "tools" | "about" = "models";
  private promptPanel: PromptLibraryPanel | null = null;
  private readonly providers: ProviderSettings;
  constructor(app: App, private readonly plugin: QiaomuAgentPlugin, private readonly connectionsOnly = false) {
    super(app, plugin);
    this.providers = new ProviderSettings(plugin, () => this.display());
  }

  override display(): void {
    const { containerEl } = this;
    this.promptPanel?.destroy(); this.promptPanel = null;
    containerEl.empty();
    containerEl.addClass("qiaomu-agent-settings");
    if (this.connectionsOnly) {
      this.renderConnectionSection(containerEl);
      return;
    }
    const header = containerEl.createDiv({ cls: "qiaomu-agent-settings__header" });
    const identity = header.createDiv({ cls: "qiaomu-agent-settings__identity" });
    setIcon(identity.createSpan({ attr: { "aria-hidden": "true" } }), "tree-deciduous");
    new Setting(identity).setName("乔木 Agent").setHeading();
    const tabs = header.createDiv({ cls: "qiaomu-agent-settings__tabs" });
    tabs.setAttribute("role", "tablist");
    const sections = [{ id: "models", label: "模型" }, { id: "chat", label: "对话" }, { id: "prompts", label: "Prompt" }, { id: "tools", label: "工具" }, { id: "about", label: "关于" }] as const;
    for (const [index, section] of sections.entries()) {
      const selected = this.activeSection === section.id;
      const button = tabs.createEl("button", { text: section.label, cls: "qiaomu-agent-settings__tab" });
      button.type = "button"; button.setAttribute("role", "tab"); button.setAttribute("aria-selected", String(selected)); button.tabIndex = selected ? 0 : -1;
      if (selected) button.addClass("is-active");
      button.addEventListener("click", () => { this.activeSection = section.id; this.display(); this.containerEl.querySelector<HTMLElement>("[role=tab][aria-selected=true]")?.focus(); });
      button.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
        event.preventDefault();
        this.activeSection = sections[(index + (event.key === "ArrowRight" ? 1 : sections.length - 1)) % sections.length]!.id;
        this.display();
        this.containerEl.querySelector<HTMLElement>("[role=tab][aria-selected=true]")?.focus();
      });
    }
    const body = containerEl.createDiv({ cls: "qiaomu-agent-settings__body qa-models" });
    body.setAttribute("role", "tabpanel");
    if (this.activeSection === "models") this.renderConnectionSection(body);
    if (this.activeSection === "chat") this.renderBehaviorSection(body);
    if (this.activeSection === "prompts") this.renderPromptSection(body);
    if (this.activeSection === "tools") this.renderToolsSection(body);
    if (this.activeSection === "about") this.renderAboutSection(body);
  }

  override hide(): void { this.promptPanel?.destroy(); this.promptPanel = null; super.hide(); }

  private renderPromptSection(containerEl: HTMLElement): void {
    this.promptPanel = new PromptLibraryPanel(this.plugin.promptHost(), containerEl.createDiv({ cls: "qa-ms-section" }));
    this.promptPanel.render();
    const place = containerEl.createDiv({ cls: "qa-ms-section" });
    const list = place.createDiv({ cls: "qa-ms-list qa-ms-settings" });
    new Setting(list).setName("保存位置").setDesc("你自己写的和改过的 Prompt 放在这个文件夹，每条一个 Markdown 文件。改位置不会移动已有文件。")
      .addText((text) => {
        text.setPlaceholder(DEFAULT_PROMPT_FOLDER).setValue(this.plugin.settings.prompts.folder);
        text.inputEl.addEventListener("change", async () => {
          const folder = cleanFolder(text.getValue()) || DEFAULT_PROMPT_FOLDER;
          text.setValue(folder);
          if (folder === this.plugin.settings.prompts.folder) return;
          this.plugin.settings.prompts.folder = folder;
          await this.plugin.savePromptSettings();
          await this.plugin.promptStore.load();
        });
      });
  }

  private renderAboutSection(containerEl: HTMLElement): void {
    const about = containerEl.createDiv({ cls: "qiaomu-agent-settings__about" });
    const external = { target: "_blank", rel: "noopener noreferrer" };

    const hero = about.createDiv({ cls: "qiaomu-agent-settings__about-hero" });
    const release = hero.createDiv({ cls: "qiaomu-agent-settings__about-release" });
    release.createSpan({ cls: "qiaomu-agent-settings__about-label", text: "当前版本" });
    release.createSpan({ cls: "qiaomu-agent-settings__version", text: `v${this.plugin.manifest.version}` });
    const actions = hero.createDiv({ cls: "qiaomu-agent-settings__about-actions" });
    const action = (label: string, icon: string, href: string) => {
      const link = actions.createEl("a", { cls: "qiaomu-agent-settings__about-action", href, attr: external });
      setIcon(link.createSpan({ attr: { "aria-hidden": "true" } }), icon);
      link.createSpan({ text: label });
    };
    this.plugin.updateNotes.addButton(actions);
    action("反馈问题", "bug", "https://github.com/joeseesun/qiaomu-agent/issues/new");
    action("使用说明", "book-open", "https://github.com/joeseesun/qiaomu-agent#readme");

    const support = about.createDiv({ cls: "qiaomu-agent-settings__about-support" });
    const qrCard = (icon: string, label: string, hint: string, src: string, alt: string) => {
      const card = support.createEl("figure", { cls: "qiaomu-agent-settings__about-qr" });
      card.createDiv({ cls: "qiaomu-agent-settings__about-qr-image" }).createEl("img", { attr: { src, alt, loading: "lazy", width: "148", height: "148" } });
      const caption = card.createEl("figcaption");
      const name = caption.createDiv({ cls: "qiaomu-agent-settings__about-qr-title" });
      setIcon(name.createSpan({ attr: { "aria-hidden": "true" } }), icon);
      name.createSpan({ text: label });
      caption.createDiv({ cls: "qiaomu-agent-settings__about-qr-hint", text: hint });
    };
    qrCard("newspaper", "关注公众号", "微信搜索「向阳乔木推荐看」", "https://radio.qiaomu.ai/assets/qiaomu_wechat_public_account_qr.jpg", "向阳乔木推荐看公众号二维码");
    qrCard("coffee", "请我喝杯咖啡", "微信扫码，支持持续更新", "https://radio.qiaomu.ai/assets/qiaomu_reward_qr.png", "向阳乔木打赏二维码");

    const footer = about.createDiv({ cls: "qiaomu-agent-settings__about-footer" });
    const links = footer.createDiv({ cls: "qiaomu-agent-settings__about-links" });
    for (const [label, href] of [["qiaomu.ai", "https://qiaomu.ai/"], ["博客", "https://blog.qiaomu.ai/"], ["X", "https://x.com/vista8"], ["GitHub", "https://github.com/joeseesun"], ["邮箱", "mailto:vista8@gmail.com"]] as const) {
      links.createEl("a", { text: label, href, attr: external });
    }
    footer.createEl("p", { text: "对话与附件只发送给你选择的本机 Agent 或模型服务商；API Key 仅保存在本机。" });
    footer.createEl("p", { text: "© 向阳乔木 · MIT 许可 · 第三方许可见插件目录 THIRD_PARTY_NOTICES.md" });
  }

  private renderConnectionSection(containerEl: HTMLElement): void {
    this.providers.render(containerEl);
  }

  private renderToolsSection(containerEl: HTMLElement): void {
    const settings = this.plugin.settings;
    const search = containerEl.createDiv({ cls: "qa-ms-section" });
    sectionHead(search, "搜索", "模型需要最新信息或读取网页时使用。");
    const brave = Boolean(this.app.secretStorage.getSecret(WEB_SEARCH_SECRET_ID));
    navRow(search.createDiv({ cls: "qa-ms-list" }), {
      icon: "globe", name: "联网搜索",
      sub: brave ? "模型自带搜索 · Brave Search 已连接" : "模型自带搜索 · 其他模型可连接 Brave Search",
      onOpen: () => new WebSearchModal(this.app, () => this.display()).open(),
    });

    if (Platform.isDesktopApp) {
      const cli = containerEl.createDiv({ cls: "qa-ms-section" });
      const connection = this.plugin.obsidianCliService.getConnection();
      const actions = sectionHead(cli, "Obsidian CLI", "日记、属性、移动与重命名交给 Obsidian 官方命令行，文件夹和模板设置保持一致。");
      const redetect = actionButton(actions, "refresh-cw", "重新检测");
      redetect.addEventListener("click", async () => {
        redetect.disabled = true; redetect.addClass("is-busy");
        await this.plugin.obsidianCliService.detect(); this.display();
      });
      switchRow(cli.createDiv({ cls: "qa-ms-list" }), {
        icon: "terminal", name: "使用 Obsidian CLI", sub: connection.detail, attention: connection.state !== "ready",
      }, settings.useObsidianCli && connection.state === "ready", "使用 Obsidian CLI", async (value) => {
        settings.useObsidianCli = value; await this.plugin.saveSettings();
      }).setDisabled(connection.state !== "ready");
    }

    const extensions = containerEl.createDiv({ cls: "qa-ms-section" });
    sectionHead(extensions, "扩展", Platform.isDesktopApp ? "技能是可复用的操作说明；工具连接（MCP）让本机 Agent 使用外部服务。" : "技能是可复用的操作说明。");
    const list = extensions.createDiv({ cls: "qa-ms-list" });
    const skills = this.plugin.skillService.list();
    const enabledSkills = skills.filter((skill) => !settings.disabledSkillPaths.includes(skill.path)).length;
    navRow(list, {
      icon: "sparkles", name: "技能",
      sub: skills.length ? `${enabledSkills} 个已启用 · 共 ${skills.length} 个` : "尚未发现技能",
      attention: !skills.length,
      onOpen: () => new CapabilitiesModal(this.app, this.plugin, "skills", undefined, () => this.display()).open(),
    });
    if (Platform.isDesktopApp) {
      let sub = "尚未添加";
      let attention = false;
      try {
        const servers = listMcpServers(settings.mcpConfig);
        const on = servers.filter((server) => !settings.disabledMcpServers.includes(server.name)).length;
        if (servers.length) sub = `${on} 个已启用 · 共 ${servers.length} 个`;
      } catch { sub = "配置无法读取"; attention = true; }
      navRow(list, {
        icon: "plug", name: "工具连接", sub, attention,
        onOpen: () => new CapabilitiesModal(this.app, this.plugin, "mcp", undefined, () => this.display()).open(),
      });
    } else {
      extensions.createDiv({ cls: "qa-ms-note", text: "本机 Agent、Obsidian CLI 和工具连接仅在桌面端可用。" });
    }
  }

  private renderBehaviorSection(containerEl: HTMLElement): void {
    this.renderAppearance(containerEl.createDiv({ cls: "qa-ms-section" }));
    this.renderDefaults(containerEl.createDiv({ cls: "qa-ms-section" }));
    this.renderCustomization(containerEl.createDiv({ cls: "qa-ms-section" }));
  }

  private renderAppearance(section: HTMLElement): void {
    const settings = this.plugin.settings;
    sectionHead(section, "外观", "只影响乔木的对话面板。");
    const preview = section.createDiv({ cls: "qa-font-preview", attr: { "aria-hidden": "true" } });
    preview.createDiv({ cls: "qa-font-preview-text", text: "乔木会用这套字体显示对话。The quick brown fox jumps over 13 lazy dogs." });
    preview.createDiv({ cls: "qa-font-preview-code", text: "const note = await app.vault.read(file);" });
    const refreshPreview = () => {
      applyChatTheme(preview, settings.chatTheme);
      preview.style.setProperty("--qa-preview-font", chatFontStack(settings.chatFontFamily, settings.chatFontCustom));
      preview.style.setProperty("--qa-preview-size", `${settings.chatFontSize}px`);
      preview.style.setProperty("--qa-preview-code-font", codeFontStack(settings.codeFontFamily));
      preview.style.setProperty("--qa-preview-code-size", `${settings.codeFontSize}px`);
    };
    refreshPreview();
    const save = async () => { refreshPreview(); await this.plugin.saveSettings(); };

    const list = section.createDiv({ cls: "qa-ms-list qa-ms-settings" });
    new Setting(list).setName("对话配色").addDropdown((dropdown) => dropdown
      .addOptions(CHAT_THEMES).setValue(settings.chatTheme).onChange(async (value) => {
        settings.chatTheme = normalizeChatTheme(value);
        refreshPreview();
        await this.plugin.saveAppearance();
      }));
    const fonts = availableFonts(document);
    const fontSetting = new Setting(list).setName("对话字体");
    const custom = new Setting(list).setName("字体名称").setDesc("填写已安装字体的名称，找不到时使用系统字体。");
    custom.settingEl.addClass("qa-ms-subsetting");
    const describe = () => {
      fontSetting.descEl.empty(); fontSetting.descEl.removeClass("is-attention");
      const family = settings.chatFontFamily;
      if (family === "custom" && !fonts.some((font) => font.family === settings.chatFontCustom)) {
        fontSetting.setDesc(`未检测到「${settings.chatFontCustom}」，正在使用系统字体。提供它的插件或主题可能未启用。`);
        fontSetting.descEl.addClass("is-attention");
      } else if (family === "obsidian" || family === "text") {
        const current = firstFamily(getComputedStyle(document.body).getPropertyValue(family === "text" ? "--font-text" : "--font-interface"));
        fontSetting.setDesc(current ? `当前：${current}` : "使用 Obsidian 外观设置里的字体。");
      } else if (family === "system") fontSetting.setDesc("苹方、微软雅黑等系统中文字体。");
    };
    fontSetting.addDropdown((dropdown) => {
      dropdown.addOption("system", "系统默认").addOption("obsidian", "跟随 Obsidian 界面字体").addOption("text", "跟随笔记正文字体");
      const group = (label: string, items: FontChoice[]) => {
        if (!items.length) return;
        const optgroup = dropdown.selectEl.createEl("optgroup", { attr: { label } });
        for (const font of items) optgroup.createEl("option", { value: `font:${font.family}`, text: font.source === "system" && font.label !== font.family ? `${font.label}（${font.family}）` : font.label });
      };
      group("主题与插件字体", fonts.filter((font) => font.source === "loaded"));
      group("已安装的系统字体", fonts.filter((font) => font.source === "system"));
      const saved = settings.chatFontCustom;
      if (saved && !fonts.some((font) => font.family === saved)) group("自定义", [{ family: saved, label: `${saved}（未检测到）`, source: "loaded" }]);
      dropdown.addOption("other", "其他字体…");
      dropdown.setValue(settings.chatFontFamily === "custom" && saved ? `font:${saved}` : settings.chatFontFamily === "custom" ? "system" : settings.chatFontFamily);
      dropdown.onChange(async (value) => {
        if (value === "other") { custom.settingEl.show(); (custom.controlEl.querySelector("input") as HTMLInputElement | null)?.focus(); return; }
        custom.settingEl.hide();
        if (value.startsWith("font:")) { settings.chatFontFamily = "custom"; settings.chatFontCustom = value.slice(5); }
        else settings.chatFontFamily = value === "obsidian" || value === "text" ? value : "system";
        describe(); await save();
      });
    });
    custom.addText((text) => {
      text.setPlaceholder("例如 朱雀仿宋").setValue(settings.chatFontCustom);
      text.inputEl.addEventListener("change", async () => {
        const family = cleanFamily(text.getValue());
        if (!family) return;
        settings.chatFontFamily = "custom"; settings.chatFontCustom = family;
        await save(); this.display();
      });
    });
    custom.settingEl.hide();
    describe();

    new Setting(list).setName("对话字号").addDropdown((dropdown) => {
      for (let size = 13; size <= 20; size++) dropdown.addOption(String(size), `${size} px`);
      dropdown.setValue(String(settings.chatFontSize)).onChange(async (value) => { settings.chatFontSize = Number(value); await save(); });
    });
    new Setting(list).setName("代码字体").addDropdown((dropdown) => dropdown
      .addOption("system", "系统等宽字体").addOption("obsidian", "跟随 Obsidian 等宽字体")
      .setValue(settings.codeFontFamily)
      .onChange(async (value) => { settings.codeFontFamily = value === "obsidian" ? "obsidian" : "system"; await save(); }));
    new Setting(list).setName("代码字号").addDropdown((dropdown) => {
      for (let size = 12; size <= 18; size++) dropdown.addOption(String(size), `${size} px`);
      dropdown.setValue(String(settings.codeFontSize)).onChange(async (value) => { settings.codeFontSize = Number(value); await save(); });
    });
  }

  private renderDefaults(section: HTMLElement): void {
    const settings = this.plugin.settings;
    sectionHead(section, "默认行为", "新对话的初始状态，也可以在输入框里随时切换。");
    const list = section.createDiv({ cls: "qa-ms-list qa-ms-settings" });
    const describe: Record<PermissionMode, string> = {
      plan: "可以读取和搜索笔记，不会修改任何文件。",
      edit: "可以在当前库中新建和修改文件，删除会移到回收站。",
      full: "可以读写这台电脑上的文件并运行命令（Codex 与 API 模型）。高风险操作仍会先问你。",
    };
    const permission = new Setting(list).setName("文件权限").setDesc(describe[settings.permissionMode]);
    permission.addDropdown((dropdown) => {
      dropdown.addOption("plan", "只读").addOption("edit", "可修改当前库");
      if (Platform.isDesktopApp || settings.permissionMode === "full") dropdown.addOption("full", "完全访问（桌面端）");
      dropdown.setValue(settings.permissionMode).onChange(async (value) => {
        const mode: PermissionMode = value === "full" ? "full" : value === "edit" ? "edit" : "plan";
        const apply = async () => { settings.permissionMode = mode; permission.setDesc(describe[mode]); dropdown.setValue(mode); await this.plugin.saveSettings(); };
        if (mode !== "full" || settings.fullAccessAcknowledged) { await apply(); return; }
        dropdown.setValue(settings.permissionMode);
        new FullAccessDialog(this.app, () => { settings.fullAccessAcknowledged = true; void apply(); }).open();
      });
    });
    new Setting(list)
      .setName("自动附加当前笔记")
      .setDesc("打开的笔记会随消息发送给所选模型。")
      .addToggle((toggle) => toggle.setValue(settings.autoAttachActiveNote).onChange(async (value) => {
        settings.autoAttachActiveNote = value; await this.plugin.saveSettings();
      }));
  }

  private renderCustomization(section: HTMLElement): void {
    const settings = this.plugin.settings;
    const advanced = section.createEl("details", { cls: "qiaomu-agent-settings__advanced-settings" });
    const summary = advanced.createEl("summary", { cls: "qa-disclosure" });
    summary.createSpan({ text: "系统 Prompt" });
    setIcon(summary.createSpan({ cls: "qa-disclosure-chevron", attr: { "aria-hidden": "true" } }), "chevron-right");
    const body = advanced.createDiv({ cls: "qa-ms-list qa-ms-wide-list" });

    const prompt = wideField(body, "系统 Prompt", "接在乔木内置的 Obsidian 约定之后，发给每个模型。");
    const textarea = prompt.createEl("textarea", { cls: "qa-ms-textarea", attr: { rows: "10", spellcheck: "false" } });
    labelField(prompt, textarea);
    textarea.value = settings.systemPrompt;
    const reset = actionButton(prompt, "rotate-ccw", "恢复默认", "is-quiet");
    reset.toggle(settings.systemPrompt !== DEFAULT_SYSTEM_PROMPT);
    textarea.addEventListener("input", async () => {
      settings.systemPrompt = textarea.value; reset.toggle(textarea.value !== DEFAULT_SYSTEM_PROMPT); await this.plugin.saveSettings();
    });
    reset.addEventListener("click", async () => {
      textarea.value = settings.systemPrompt = DEFAULT_SYSTEM_PROMPT; reset.hide(); await this.plugin.saveSettings();
    });

  }

}
