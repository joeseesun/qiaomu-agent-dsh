import type { ChatAttachment, ChatRequest } from "../types";

export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const MAX_ATTACHMENTS = 6;
const textExtensions = /\.(md|txt|csv|json|yaml|yml|xml|html|css|js|jsx|ts|tsx|py|rs|go|java|sh|log)$/i;
export function attachmentType(name: string, mime = ""): string {
  if (/\.(png|jpe?g|webp|gif)$/i.test(name) || /^image\/(png|jpeg|webp|gif)$/.test(mime)) {
    if (/\.jpe?g$/i.test(name)) return "image/jpeg";
    return /^image\/(png|jpeg|webp|gif)$/.test(mime) ? mime : `image/${name.split(".").pop()?.toLowerCase()}`;
  }
  if (/\.pdf$/i.test(name) || mime === "application/pdf") return "application/pdf";
  if (textExtensions.test(name) || mime.startsWith("text/")) return "text/plain";
  throw new Error(`${name}：暂不支持此格式，请使用文本、PNG/JPEG/WebP/GIF 或 PDF`);
}
export async function readAttachment(file: File, vaultPath?: string): Promise<ChatAttachment> {
  if (file.size > MAX_ATTACHMENT_BYTES) throw new Error(`${file.name} 超过 5 MB 限制`);
  const mediaType = attachmentType(file.name, file.type);
  const result: ChatAttachment = { id: crypto.randomUUID(), name: file.name, mediaType, size: file.size, vaultPath };
  if (mediaType === "text/plain") result.text = await file.text();
  else result.url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`无法读取 ${file.name}`));
    reader.readAsDataURL(file);
  });
  return result;
}
export function attachmentContext(request: ChatRequest): string {
  return (request.attachments ?? []).filter((a) => a.text !== undefined).map((a) =>
    `<attached_file name=${JSON.stringify(a.name)} path=${JSON.stringify(a.vaultPath ?? a.name)}>\n${a.text}\n</attached_file>`
  ).join("\n\n");
}
export function validateAttachments(attachments: ChatAttachment[], backendId: string): void {
  if (attachments.length > MAX_ATTACHMENTS) throw new Error("每轮最多附加 6 个文件");
  if (attachments.reduce((sum, a) => sum + a.size, 0) > 10 * 1024 * 1024) throw new Error("每轮附件总计不能超过 10 MB");
  for (const item of attachments) {
    if (item.size > MAX_ATTACHMENT_BYTES) throw new Error(`${item.name} 超过 5 MB 限制`);
    if (item.mediaType === "application/pdf" && backendId !== "api") throw new Error("PDF 附件目前需要模型 API 连接；本地 Agent 请使用文本或图片");
    if (item.url && backendId !== "api" && !["cli:codex", "cli:kimi", "cli:qwen", "cli:gemini", "cli:opencode"].includes(backendId)) {
      throw new Error("当前 CLI 连接尚未接入多模态附件，请改用文本或支持图片的连接");
    }
  }
}
/** Notes a folder attachment can carry before the rest are only listed by path. */
export const FOLDER_NOTE_LIMIT = 40;
export const FOLDER_TEXT_LIMIT = 200_000;
/** One text attachment holding a folder's notes, each under its own path heading. */
export function folderAttachment(folder: string, notes: { path: string; text: string }[]): ChatAttachment {
  const sorted = [...notes].sort((a, b) => a.path.localeCompare(b.path));
  const parts: string[] = []; const skipped: string[] = []; let used = 0;
  for (const note of sorted) {
    const part = `## ${note.path}\n\n${note.text.trim()}`;
    if (parts.length >= FOLDER_NOTE_LIMIT || used + part.length > FOLDER_TEXT_LIMIT) { skipped.push(note.path); continue; }
    parts.push(part); used += part.length;
  }
  if (skipped.length) parts.push(`（另有 ${skipped.length} 篇笔记未附加全文，需要时请单独附加）\n${skipped.map((path) => `- ${path}`).join("\n")}`);
  if (!sorted.length) parts.push("（此文件夹中没有 Markdown 笔记）");
  const text = parts.join("\n\n");
  const name = folder.split("/").pop() || folder;
  return { id: crypto.randomUUID(), name: `${name}/`, mediaType: "text/plain", size: new TextEncoder().encode(text).length, text, vaultPath: folder };
}
/** A read web page as a text attachment; the address stays in the text so the model can cite it. */
export function webPageAttachment(page: { url: string; title: string; text: string }): ChatAttachment {
  const text = `来源：${page.url}\n\n${page.text}`;
  const name = page.title.trim().slice(0, 80) || new URL(page.url).hostname;
  return { id: crypto.randomUUID(), name, mediaType: "text/plain", size: new TextEncoder().encode(text).length, text, vaultPath: page.url };
}
