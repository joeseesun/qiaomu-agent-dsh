import { App, MarkdownView, Menu, Modal, Notice, Platform, Setting, TFile, requestUrl, type EditorPosition } from "obsidian";
import type { ChatAttachment } from "../types";
import { readAttachment } from "../services/attachments";
import { localFileTarget } from "../services/local-file-links";
import { openArtifact, revealFileLabel } from "./local-file-menu";

function imageName(file: ChatAttachment): string {
  const extension = file.mediaType === "image/jpeg" ? "jpg" : file.mediaType.split("/")[1] || "png";
  const safe = file.name.replace(/[\\/:*?"<>|\x00-\x1f]/g, "-").trim();
  return /\.(png|jpe?g|gif|webp|svg)$/i.test(safe) ? safe : `${safe || "image"}.${extension}`;
}

async function imageBytes(app: App, file: ChatAttachment): Promise<ArrayBuffer> {
  if (file.vaultPath) return app.vault.adapter.readBinary(file.vaultPath);
  if (!file.url) throw new Error("图片地址不可用");
  if (file.url.startsWith("data:")) return (await fetch(file.url)).arrayBuffer();
  if (file.url.startsWith("app://")) {
    const resource = file.url.split("?")[0];
    const vaultFile = app.vault.getFiles().find((item) => app.vault.adapter.getResourcePath(item.path).split("?")[0] === resource);
    if (vaultFile) return app.vault.readBinary(vaultFile);
  }
  try {
    const response = await fetch(file.url);
    if (!response.ok) throw new Error(String(response.status));
    return response.arrayBuffer();
  } catch {
    return (await requestUrl({ url: file.url })).arrayBuffer;
  }
}

export async function downloadConversationImage(app: App, file: ChatAttachment): Promise<void> {
  const bytes = await imageBytes(app, file);
  const url = URL.createObjectURL(new Blob([bytes], { type: file.mediaType }));
  const link = document.createElement("a");
  link.href = url; link.download = imageName(file);
  document.body.appendChild(link);
  link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Turn a displayed image back into portable request data for image editing. */
export async function referenceImageAttachment(app: App, image: ChatAttachment): Promise<ChatAttachment> {
  const bytes = await imageBytes(app, image);
  return { ...await readAttachment(new File([bytes], imageName(image), { type: image.mediaType })), intent: "edit" };
}

interface InsertTarget { file: TFile; view: MarkdownView; cursor: EditorPosition; document: string }

function currentTarget(app: App, note: TFile | null): InsertTarget | null {
  if (!note) return null;
  const view = app.workspace.getLeavesOfType("markdown").map((leaf) => leaf.view)
    .find((item): item is MarkdownView => item instanceof MarkdownView && item.file?.path === note.path);
  if (!view || !view.file) return null;
  return { file: view.file, view, cursor: view.editor.getCursor(), document: view.editor.getValue() };
}

export class ImageInsertDialog extends Modal {
  private target: InsertTarget | null;
  constructor(app: App, private readonly image: ChatAttachment, note: TFile | null) {
    super(app); this.target = currentTarget(app, note);
  }
  override onOpen(): void {
    this.modalEl.addClass("qa-image-insert-dialog");
    this.titleEl.setText("插入图片到笔记");
    this.contentEl.empty();
    if (!this.target) {
      this.contentEl.createEl("p", { text: "请先打开要插入图片的 Markdown 笔记。" });
      new Setting(this.contentEl).addButton((button) => button.setButtonText("关闭").onClick(() => this.close()));
      return;
    }
    this.contentEl.createEl("p", { text: this.target.file.path, cls: "qa-image-target" });
    this.contentEl.createEl("p", { text: `将在光标处插入「${this.image.name}」。` });
    new Setting(this.contentEl).addButton((button) => button.setButtonText("取消").onClick(() => this.close()))
      .addButton((button) => button.setButtonText("插入图片").setCta().onClick(async () => {
        button.setDisabled(true);
        try { await this.insert(); this.close(); new Notice("图片已插入笔记"); }
        catch (error) { new Notice(error instanceof Error ? error.message : String(error)); button.setDisabled(false); }
      }));
  }
  private async insert(): Promise<void> {
    const target = this.target;
    if (!target || target.view.file?.path !== target.file.path || target.view.editor.getValue() !== target.document) throw new Error("笔记内容已变化，请重新选择插入位置");
    let imageFile = this.image.vaultPath && !this.image.vaultPath.startsWith(".qiaomu-agent/")
      ? this.app.vault.getAbstractFileByPath(this.image.vaultPath) : null;
    if (!(imageFile instanceof TFile)) {
      const bytes = await imageBytes(this.app, this.image);
      const path = await this.app.fileManager.getAvailablePathForAttachment(imageName(this.image), target.file.path);
      imageFile = await this.app.vault.createBinary(path, bytes);
    }
    if (target.view.file?.path !== target.file.path || target.view.editor.getValue() !== target.document) throw new Error("笔记内容已变化，请重新选择插入位置");
    if (!(imageFile instanceof TFile)) throw new Error("图片无法保存到笔记库");
    const link = this.app.fileManager.generateMarkdownLink(imageFile, target.file.path);
    target.view.editor.replaceRange(`!${link}`, target.cursor);
  }
  override onClose(): void { this.contentEl.empty(); }
}

export function showConversationImageMenu(app: App, image: ChatAttachment, event: MouseEvent, note: TFile | null, onReference: (image: ChatAttachment) => void): void {
  const menu = new Menu();
  const target = image.vaultPath || image.url;
  if (Platform.isDesktopApp && target && localFileTarget(app, target)) menu.addItem((item) => item.setTitle(revealFileLabel()).setIcon("folder-open").onClick(() => openArtifact(app, target, "", true)));
  menu.addItem((item) => item.setTitle("下载图片").setIcon("download").onClick(() => void downloadConversationImage(app, image).catch((error) => new Notice(`下载失败：${String(error)}`))));
  menu.addItem((item) => item.setTitle("插入到当前笔记…").setIcon("file-plus-2").onClick(() => new ImageInsertDialog(app, image, note).open()));
  menu.addItem((item) => item.setTitle("作为参考图加入对话").setIcon("image-plus").onClick(() => onReference(image)));
  menu.showAtMouseEvent(event);
}

export class ConversationImageLightbox extends Modal {
  private index: number;
  constructor(app: App, private readonly images: ChatAttachment[], selected: ChatAttachment, private readonly note: TFile | null, private readonly onReference: (image: ChatAttachment) => void) {
    super(app); this.index = Math.max(0, images.findIndex((item) => item === selected || item.id === selected.id));
    this.scope.register([], "ArrowLeft", () => { this.move(-1); return false; });
    this.scope.register([], "ArrowRight", () => { this.move(1); return false; });
  }
  override onOpen(): void { this.modalEl.addClass("qa-image-lightbox"); this.draw(); }
  private move(delta: number): void {
    if (this.images.length < 2) return;
    this.index = (this.index + delta + this.images.length) % this.images.length;
    this.draw();
  }
  private draw(): void {
    const image = this.images[this.index];
    if (!image?.url) return;
    this.titleEl.setText(image.name);
    this.contentEl.empty();
    const stage = this.contentEl.createDiv({ cls: "qa-image-stage" });
    if (this.images.length > 1) stage.createEl("button", { text: "‹", cls: "qa-image-previous", attr: { "aria-label": "上一张图片" } }).onclick = () => this.move(-1);
    const picture = stage.createEl("img", { attr: { src: image.url, alt: image.name } });
    picture.addEventListener("contextmenu", (event) => { event.preventDefault(); showConversationImageMenu(this.app, image, event, this.note, (reference) => { this.onReference(reference); this.close(); }); });
    if (this.images.length > 1) stage.createEl("button", { text: "›", cls: "qa-image-next", attr: { "aria-label": "下一张图片" } }).onclick = () => this.move(1);
    const footer = this.contentEl.createDiv({ cls: "qa-image-footer" });
    footer.createSpan({ text: `${this.index + 1} / ${this.images.length}` });
    const actions = footer.createDiv({ cls: "qa-image-actions" });
    actions.createEl("button", { text: "下载" }).onclick = () => void downloadConversationImage(this.app, image).catch((error) => new Notice(`下载失败：${String(error)}`));
    actions.createEl("button", { text: "插入到当前笔记" }).onclick = () => new ImageInsertDialog(this.app, image, this.note).open();
    actions.createEl("button", { text: "作为参考图" }).onclick = () => { this.onReference(image); this.close(); };
  }
  override onClose(): void { this.contentEl.empty(); }
}
