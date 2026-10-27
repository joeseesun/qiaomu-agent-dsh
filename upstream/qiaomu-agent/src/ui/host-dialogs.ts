import { App, ButtonComponent, FuzzySuggestModal, Modal, Setting, Notice, TFile, TFolder } from "obsidian";
import type { PromptTemplate } from "../types";
import { appendReply, undoReply } from "../services/note-actions";

export class FilePicker extends FuzzySuggestModal<TFile> {
  constructor(app: App, private readonly choose: (file: TFile) => void, private readonly markdownOnly = false) { super(app); this.setPlaceholder("搜索文件名或路径…"); }
  getItems(): TFile[] { return this.markdownOnly ? this.app.vault.getMarkdownFiles() : this.app.vault.getFiles(); }
  getItemText(file: TFile): string { return file.path; }
  onChooseItem(file: TFile): void { this.choose(file); }
}
export class FolderPicker extends FuzzySuggestModal<TFolder> {
  constructor(app: App, private readonly choose: (folder: TFolder) => void) { super(app); this.setPlaceholder("搜索文件夹…"); }
  getItems(): TFolder[] { return this.app.vault.getAllLoadedFiles().filter((item): item is TFolder => item instanceof TFolder && !item.isRoot()); }
  getItemText(folder: TFolder): string { return folder.path; }
  onChooseItem(folder: TFolder): void { this.choose(folder); }
}
export class AppendDialog extends Modal {
  constructor(app: App, private readonly path: string, private readonly text: string, private readonly prepare?: () => Promise<void>) { super(app); }
  override onOpen(): void {
    this.titleEl.setText("追加回复");
    this.contentEl.createEl("p", { text: this.path });
    this.contentEl.createEl("pre", { cls: "qa-append-preview", text: this.text });
    new Setting(this.contentEl).addButton((b) => b.setButtonText("取消").onClick(() => this.close())).addButton((b) => b.setButtonText("追加到文件末尾").setCta().onClick(async () => {
      b.setDisabled(true);
      try {
        await this.prepare?.();
        const receipt = await appendReply(this.app, this.path, this.text);
        this.contentEl.empty(); this.titleEl.setText("已追加"); this.contentEl.createEl("p", { text: this.path });
        new Setting(this.contentEl).addButton((open) => open.setButtonText("打开笔记").onClick(() => { void this.app.workspace.openLinkText(this.path, "", true); this.close(); }))
          .addButton((undo) => undo.setButtonText("撤销本次追加").onClick(async () => {
            undo.setDisabled(true);
            try { await undoReply(this.app, receipt); new Notice("已撤销本次追加"); this.close(); }
            catch (e) { new Notice(String(e)); undo.setDisabled(false); }
          }));
      } catch (e) { new Notice(String(e)); b.setDisabled(false); }
    }));
  }
  override onClose(): void { this.contentEl.empty(); }
}

/** Shown once, the first time full access is turned on: what it allows and what still asks. */
export class FullAccessDialog extends Modal {
  constructor(app: App, private readonly accept: () => void) { super(app); }
  override onOpen(): void {
    this.setTitle("开启完全访问");
    this.contentEl.addClass("qa-full-access-dialog");
    this.contentEl.createEl("p", { text: "Agent 将可以不经询问地读写这台电脑上的文件并运行命令，像在终端里工作一样。" });
    const list = this.contentEl.createEl("ul");
    for (const line of [
      "读到的文件内容和命令输出会发送给当前模型服务商。",
      "每一轮修改都会记录，可以一键撤销；删除会移到废纸篓。",
      "读取凭据、改动启动项、删除大范围目录或运行破坏性命令时，仍会先问你。",
      "网页或文件里的恶意指令可能诱导 Agent 行事，只在你信任当前任务时开启。",
    ]) list.createEl("li", { text: line });
    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText("取消").onClick(() => this.close()))
      .addButton((button) => button.setButtonText("开启完全访问").setWarning().onClick(() => { this.close(); this.accept(); }));
  }
  override onClose(): void { this.contentEl.empty(); }
}
/** Asks for a web address; `read` resolves once the page is attached, or rejects with a reason to show. */
export class WebPageDialog extends Modal {
  constructor(app: App, private readonly read: (url: string, signal: AbortSignal) => Promise<void>) { super(app); }
  private controller: AbortController | null = null;
  override onOpen(): void {
    this.setTitle("添加网页");
    const label = this.contentEl.createEl("label", { cls: "qiaomu-agent__sr-only", text: "网页地址" });
    const input = this.contentEl.createEl("input", { cls: "qa-web-page-input", type: "url", attr: { placeholder: "https://" } });
    input.id = `qa-web-url-${crypto.randomUUID()}`;
    label.htmlFor = input.id;
    const status = this.contentEl.createEl("p", { cls: "qa-web-page-status", attr: { role: "status" } });
    let submit: ButtonComponent | null = null;
    const start = () => {
      const url = input.value.trim();
      if (!url || this.controller) return;
      this.controller = new AbortController();
      status.setText("正在读取网页…"); submit?.setDisabled(true); input.disabled = true;
      void this.read(url, this.controller.signal).then(() => this.close()).catch((error) => {
        if (this.controller?.signal.aborted) return;
        this.controller = null;
        status.setText(error instanceof Error ? error.message : String(error));
        submit?.setDisabled(false); input.disabled = false; input.focus();
      });
    };
    input.addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); start(); } });
    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText("取消").onClick(() => this.close()))
      .addButton((button) => { submit = button; button.setButtonText("读取").setCta().onClick(start); });
    window.setTimeout(() => input.focus());
  }
  override onClose(): void { this.controller?.abort(); this.contentEl.empty(); }
}
