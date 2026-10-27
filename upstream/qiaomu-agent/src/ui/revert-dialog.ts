import { Modal, Notice, Setting, type App } from "obsidian";
import type { FileChange } from "../types";
import { applyRollback, planRollback, type RollbackItem } from "../services/change-tracker";
import { externalFiles } from "../services/local-host";

function describe(change: FileChange): string {
  if (change.binary) return "非文本或过大";
  if (!change.tracked) return change.outside ? "库外文件" : "未记录修改前内容";
  return (change.outside ? "库外 · " : "") + (change.before === null ? "将移到回收站" : change.after === null ? "将重新创建" : "恢复到修改前");
}

/**
 * Pre-checks every change before touching anything: files still exactly as the agent left them
 * are restored; files edited since need an explicit opt-in; untracked ones are only listed.
 */
export class RevertDialog extends Modal {
  private items: RollbackItem[] = [];
  private readonly forced = new Set<string>();

  constructor(app: App, private readonly changes: FileChange[], private readonly done: (restored: string[]) => void) { super(app); }

  override onOpen(): void {
    this.setTitle("撤销这一轮的修改");
    this.contentEl.addClass("qa-revert");
    this.contentEl.createDiv({ cls: "qa-revert-status", text: "正在检查文件当前状态…" });
    void planRollback(this.app, this.changes, externalFiles()).then((items) => { this.items = items; this.draw(); }, (error: unknown) => {
      this.contentEl.empty();
      this.contentEl.createDiv({ cls: "qa-revert-status", text: `检查失败：${error instanceof Error ? error.message : String(error)}` });
    });
  }

  override onClose(): void { this.contentEl.empty(); }

  private draw(): void {
    const { contentEl } = this;
    contentEl.empty();
    const safe = this.items.filter((item) => item.kind === "safe");
    const conflict = this.items.filter((item) => item.kind === "conflict");
    const untracked = this.items.filter((item) => item.kind === "untracked");

    const section = (title: string, hint: string, list: RollbackItem[], checkable: boolean) => {
      if (!list.length) return;
      contentEl.createEl("h4", { text: `${title}（${list.length}）` });
      contentEl.createEl("p", { cls: "setting-item-description", text: hint });
      const ul = contentEl.createEl("ul", { cls: "qa-revert-list" });
      for (const item of list) {
        const li = ul.createEl("li");
        if (checkable) {
          const box = li.createEl("input", { type: "checkbox" });
          box.id = `qa-revert-${item.change.path}`;
          box.checked = this.forced.has(item.change.path);
          box.addEventListener("change", () => { if (box.checked) this.forced.add(item.change.path); else this.forced.delete(item.change.path); this.drawButtons(); });
          li.createEl("label", { text: item.change.path, attr: { for: box.id } });
        } else li.createSpan({ cls: "qa-revert-path", text: item.change.path });
        li.createSpan({ cls: "qa-revert-note", text: describe(item.change) });
      }
    };
    section("可以安全恢复", "这些文件仍是 Agent 修改后的样子。", safe, false);
    section("之后被改过", "Agent 修改后这些文件又变了。勾选后恢复会覆盖之后的编辑。", conflict, true);
    section("无法自动恢复", "没有记录到修改前的内容，请手动检查。", untracked, false);
    if (!safe.length && !conflict.length) contentEl.createEl("p", { text: "没有可以自动恢复的文件。" });
    this.buttons = contentEl.createDiv();
    this.drawButtons();
  }

  private buttons: HTMLElement | null = null;

  private drawButtons(): void {
    if (!this.buttons) return;
    this.buttons.empty();
    const targets = this.items.filter((item) => item.kind === "safe" || (item.kind === "conflict" && this.forced.has(item.change.path)));
    new Setting(this.buttons)
      .addButton((button) => button.setButtonText("取消").onClick(() => this.close()))
      .addButton((button) => {
        button.setButtonText(targets.length ? `恢复 ${targets.length} 个文件` : "没有可恢复的文件").setWarning().setDisabled(!targets.length);
        button.onClick(async () => {
          button.setDisabled(true).setButtonText("正在恢复…");
          const result = await applyRollback(this.app, targets.map((item) => item.change), externalFiles());
          if (result.failed.length) new Notice(`有 ${result.failed.length} 个文件恢复失败：${result.failed.map((f) => `${f.path}（${f.error}）`).join("；")}`);
          else new Notice(`已恢复 ${result.restored.length} 个文件`);
          this.done(result.restored);
          this.close();
        });
      });
  }
}
