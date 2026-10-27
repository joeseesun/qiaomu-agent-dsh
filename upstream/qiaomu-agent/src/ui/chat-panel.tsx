import { useChat, type Chat } from "@ai-sdk/react";
import { Component, Keymap, MarkdownRenderer, Notice, Platform, type App, type TFile } from "obsidian";
import { Check, ChevronDown, ChevronRight, Copy, FileText, FilePlus, Folder, Link, History, Plus, SquarePen, X, CalendarPlus, FilePlus2, Slash, Paperclip, TextSelect, Sparkles, Shield, FolderPen, ShieldAlert, Pencil, GitBranch, BookOpen, Settings, TreeDeciduous, Globe, Newspaper, Shapes, Plug } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { PermissionMode, ChatAttachment, SentPrompt, QuestionAnswers } from "../types";
import type { ModelSource } from "../services/model-sources";
import { ModelPicker, type PickerSelection } from "./model-picker";
import { BrandIcon } from "./brand-icon";
import { ApprovalCard, ChangeSummary } from "./turn-review";
import { readAttachment, MAX_ATTACHMENTS } from "../services/attachments";
import { slashQuery, startsFileMention } from "../services/composer";
import { starterScene, type StarterScene } from "../services/starter-prompts";
import { stripPrompts, type PromptItem, type PromptSettings } from "../services/prompt-library";
import { fillPrompt, promptFields, usesClipboard, type PromptContext, type PromptField } from "../services/prompt-template";
import { PromptForm, PromptStrip, promptGroups, type PromptActions } from "./prompt-strip";
import type { AddKind } from "../services/hotkeys";
import { Attachments } from "../components/ai-elements/attachments";
import { type AgentMessage, messageText, messageUsage } from "../services/chat-transport";
import { Conversation, ConversationContent, ConversationScrollButton } from "../components/ai-elements/conversation";
import { Message, MessageContent, MessageAction, MessageActions } from "../components/ai-elements/message";
import { PromptInput, PromptInputFooter, PromptInputHeader, PromptInputSubmit, PromptInputTextarea, PromptInputTools } from "../components/ai-elements/prompt-input";
import { splitMermaid } from "../services/mermaid-content";
import { internalLinkTarget, tidyInternalLinks } from "../services/markdown-links";
import { localFileTarget } from "../services/local-file-links";
import { openArtifact, showLocalFileMenu } from "./local-file-menu";
import { MermaidDiagram } from "./mermaid-diagram";
import { ReplyTimeline, WorkingStatus } from "./reply-timeline";
import { QuestionCard } from "./question-card";
import { ComposerPopover, effortLabel } from "./composer-popover";
import { ContextRing } from "./context-ring";
import { conversationImages } from "../services/conversation-images";
import { ConversationImageLightbox, referenceImageAttachment, showConversationImageMenu } from "./conversation-image";

interface Props {
  chat: Chat<AgentMessage>; app: App; parent: Component;
  conversationId: string; conversationTitle: string;
  branch: { parentId: string; parentTitle: string; messageId: string } | null;
  onOpenParent: (id: string) => void; onForkMessage: (messageId: string) => void;
  imageTargetNote: TFile | null;
  backendLabel: string; skillLabel: string; permission: PermissionMode; fileAccessAvailable: boolean; fullAccessAvailable: boolean; note: TFile | null; detachedNote?: TFile | null;
  statusText: string; prefill: string; prefillVersion: number; submitVersion?: number; focusVersion?: number;
  addRequest?: { kind: AddKind; version: number }; addHotkeys?: Partial<Record<AddKind, string>>;
  onConnection: () => void; onNew: () => void; onOpenSettings: () => void; onHistory: (event: MouseEvent) => void;
  onSkill: (event: MouseEvent) => void; onPermission: (mode: PermissionMode) => void;
  onEditMessage: () => void;
  onToggleNote: () => void; onPersist: () => Promise<void>;
  editorSelection: { label: string; detail: string } | null; onDismissSelection: () => void; onComposerFocus: () => void;
  reading?: ReadingChip | null; onDismissReading?: () => void;
  onApprove: (id: string, choice: string | null) => void; onAnswer: (id: string, answers: QuestionAnswers | null) => void; onRevertChanges: (messageId: string) => void; onOpenFile: (path: string) => void;
  efforts: string[]; effort: string; modelLoading: boolean; onEffort: (effort: string) => void;
  sources: ModelSource[]; selection: PickerSelection | null; recentModels: PickerSelection[];
  onPickModel: (source: string, model: string) => void; onLoadModels: (source: string) => void; onManageModels: () => void;
  promptCatalog: PromptItem[]; promptSettings: PromptSettings; onManagePrompts: (draft?: string) => void;
  onPromptUsed: (id: string) => void; onEditPrompt: (item: PromptItem) => void; onTogglePromptPin: (item: PromptItem) => void;
  /** Runs a prompt chosen outside the panel (command palette); each new version runs once. */
  promptRequest?: { id: string; version: number };
  onPickFile: (choose: (attachment: ChatAttachment) => void) => void;
  onPickFolder: (choose: (attachment: ChatAttachment) => void) => void;
  /** Absent where pages cannot be read (mobile). */
  onPickWebPage?: (choose: (attachment: ChatAttachment) => void) => void;
  /** Web search state for the selected model; absent when it cannot search (local agents search on their own). */
  webSearch?: boolean; onToggleWebSearch?: () => void;
  onValidateAttachments: (attachments: ChatAttachment[]) => void;
  onAppend: (text: string, daily: boolean) => void;
}

/** Keep the Obsidian renderer and each render's resources inside the mounted component. */
function HostMarkdown({ text, sourcePath, app, parent }: { text: string; sourcePath: string; app: App; parent: Component }) {
  const target = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = target.current;
    if (!host) return;
    let active = true;
    const child = new Component();
    parent.addChild(child);
    const staging = host.ownerDocument.createElement("div");
    staging.className = "qiaomu-agent__markdown";
    void MarkdownRenderer.render(app, text, staging, sourcePath, child).then(() => {
      tidyInternalLinks(staging);
      if (active) host.replaceChildren(staging);
    }).catch(() => { if (active) host.textContent = text; });
    return () => { active = false; parent.removeChild(child); };
  }, [text, sourcePath, app, parent]);
  // Rendered outside a note view, internal links get no host click handling; open them as a note would.
  useEffect(() => {
    const host = target.current;
    if (!host) return;
    const open = (event: MouseEvent) => {
      if (event.type === "auxclick" && event.button !== 1) return;
      const anchor = event.target instanceof host.ownerDocument.defaultView!.Element ? event.target.closest("a") : null;
      const raw = anchor?.getAttribute("data-href") ?? anchor?.getAttribute("href");
      if (raw && localFileTarget(app, raw, sourcePath)) {
        event.preventDefault(); event.stopPropagation();
        openArtifact(app, raw, sourcePath);
        return;
      }
      const link = anchor && internalLinkTarget(anchor);
      if (!link) return;
      event.preventDefault();
      void app.workspace.openLinkText(link, sourcePath, event.button === 1 ? "tab" : Keymap.isModEvent(event));
    };
    const menu = (event: MouseEvent) => {
      const anchor = event.target instanceof host.ownerDocument.defaultView!.Element ? event.target.closest("a") : null;
      const raw = anchor?.getAttribute("data-href") ?? anchor?.getAttribute("href");
      if (!raw || !localFileTarget(app, raw, sourcePath)) return;
      event.preventDefault(); event.stopPropagation();
      showLocalFileMenu(app, raw, sourcePath, event);
    };
    host.addEventListener("click", open, true);
    host.addEventListener("auxclick", open, true);
    host.addEventListener("contextmenu", menu, true);
    return () => { host.removeEventListener("click", open, true); host.removeEventListener("auxclick", open, true); host.removeEventListener("contextmenu", menu, true); };
  }, [app, sourcePath]);
  return <div className="qa-markdown-host" ref={target} />;
}

function NoteMarkdown(props: { text: string; sourcePath: string; app: App; parent: Component }) {
  let charts = 0;
  return <div className="qa-markdown-response">{splitMermaid(props.text).map((part, index) => part.kind === "pending" ? <pre key={index}>{part.text}</pre> : part.kind === "mermaid"
    ? ++charts <= 6 ? <MermaidDiagram key={index} source={part.text} /> : <pre key={index}>{part.text}</pre>
    : <HostMarkdown key={index} {...props} text={part.text} />)}</div>;
}

const messageTime = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });

export function ChatPanel(props: Props) {
  const { messages, status, error, sendMessage, regenerate, setMessages, stop, clearError } = useChat({ chat: props.chat, experimental_throttle: 75 });
  const [input, setInput] = useState("");
  const [stopped, setStopped] = useState(false);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [reading, setReading] = useState(0);
  const [attachmentError, setAttachmentError] = useState("");
  const [menuDismissed, setMenuDismissed] = useState(false);
  const [menuIndex, setMenuIndex] = useState(0);
  // The draft set aside when the add menu opens the prompt list; Escape brings it back.
  const draftBeforePrompts = useRef<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const previousConversation = useRef(props.conversationId);
  const upload = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (previousConversation.current === props.conversationId) return;
    previousConversation.current = props.conversationId;
    setInput(""); setAttachments([]); setEditingId(null); setEditText(""); clearError();
  }, [props.conversationId, clearError]);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const locked = useRef(false);
  const inputId = useId();
  const running = status === "submitted" || status === "streaming";
  const contextUsage = latestUsage(messages);
  const query = slashQuery(input);
  const scene = starterScene({ selection: Boolean(props.editorSelection), reading: Boolean(props.reading), noteName: props.note?.basename });
  // Enabled prompts, pinned and fitting ones first; a query searches all of them.
  const promptChoices = query === null ? [] : promptGroups(props.promptCatalog, props.promptSettings, scene, query)
    .flatMap((group) => group.items.map((item) => ({ ...item, group: group.name })));
  const [promptForm, setPromptForm] = useState<{ item: PromptItem; fields: PromptField[]; values: Record<string, string>; context: PromptContext; draft: string } | null>(null);
  const menuOpen = query !== null && !menuDismissed;
  const imageEditing = attachments.some((file) => file.intent === "edit");
  const permissionLabel = imageEditing ? "图片编辑只读" : props.permission === "full" ? "完全访问" : props.permission === "edit" ? "可写当前库" : "只读";
  const PermissionIcon = imageEditing ? Shield : props.permission === "full" ? ShieldAlert : props.permission === "edit" ? FolderPen : Shield;
  const insertPrompt = (body: string) => {
    const draft = draftBeforePrompts.current ?? (slashQuery(input) === null ? input : null);
    draftBeforePrompts.current = null;
    setInput(draft ? `${draft.trimEnd()}\n\n${body}` : body);
    setMenuDismissed(true); textarea.current?.focus();
  };
  const choosePrompt = (index: number, insert = false) => {
    const prompt = promptChoices[index];
    const draft = draftBeforePrompts.current;
    draftBeforePrompts.current = null;
    setMenuDismissed(true);
    if (prompt && insert) { setInput(draft ?? ""); insertFilled(prompt, draft ?? ""); return; }
    setInput(draft ?? "");
    if (prompt) void runPrompt(prompt, draft ?? ""); else { props.onManagePrompts(); textarea.current?.focus(); }
  };
  const promptContext = async (item: PromptItem): Promise<PromptContext> => ({
    selection: props.editorSelection?.detail, note: props.note?.basename, reading: props.reading?.label,
    ...(usesClipboard(item.body) ? { clipboard: await navigator.clipboard.readText().catch(() => "") } : {}),
  });
  // Context placeholders are resolved; blanks stay as 「名称」 for the user to fill in before sending.
  const insertFilled = (item: PromptItem, draft: string) => {
    void promptContext(item).then((context) => {
      const blanks = Object.fromEntries(promptFields(item.body, context).map((field) => [field.name, `「${field.name}」`]));
      draftBeforePrompts.current = draft || null;
      insertPrompt(fillPrompt(item.body, blanks, context));
    });
  };
  /** One click runs a prompt: straight away, or after the blanks it needs. What is typed in the composer goes along. */
  const runPrompt = async (item: PromptItem, draft = slashQuery(input) === null ? input : "") => {
    if (item.run === "insert") { insertFilled(item, draft); return; }
    if (running) { new Notice("等这条回复结束后再运行 Prompt"); return; }
    const context = await promptContext(item);
    const fields = promptFields(item.body, context);
    if (!fields.length) { void sendPrompt(item, {}, context, draft); return; }
    // Typed text fills the first blank that has no default, like a Raycast argument.
    const target = draft.trim() ? fields.find((field) => !field.defaultValue && !field.options) : undefined;
    setPromptForm({ item, fields, context, values: target ? { [target.name]: draft.trim() } : {}, draft: target ? "" : draft });
  };
  const sendPrompt = async (item: PromptItem, values: Record<string, string>, context: PromptContext, draft: string) => {
    const extra = [...Object.entries(values).filter(([, value]) => value.trim()).map(([name, value]) => `${name}：${value.trim()}`), draft.trim()].filter(Boolean).join("\n");
    const text = [fillPrompt(item.body, values, context), draft.trim()].filter(Boolean).join("\n\n");
    setPromptForm(null);
    props.onPromptUsed(item.id);
    await submit(text, { id: item.id, title: item.title, ...(extra ? { extra } : {}) });
  };
  const promptActions: PromptActions = {
    run: (item) => void runPrompt(item), insert: (item) => insertFilled(item, slashQuery(input) === null ? input : ""),
    edit: props.onEditPrompt, togglePin: props.onTogglePromptPin, manage: () => props.onManagePrompts(),
  };
  useEffect(() => {
    const item = props.promptRequest && props.promptCatalog.find((prompt) => prompt.id === props.promptRequest!.id);
    if (item) void runPrompt(item);
  }, [props.promptRequest?.version]);
  const addAttachment = (file: ChatAttachment) => {
    if (!mounted.current) return;
    setAttachments((current) => {
      if (current.length >= MAX_ATTACHMENTS || current.reduce((sum, a) => sum + a.size, file.size) > 10 * 1024 * 1024) { new Notice("最多 6 个附件，总计不超过 10 MB"); return current; }
      return [...current, file];
    });
  };
  const addFiles = async (files: File[]) => {
    setReading((n) => n + 1); setAttachmentError("");
    try { for (const file of files) { try { addAttachment(await readAttachment(file)); } catch (e) { if (mounted.current) setAttachmentError(String(e)); } } }
    finally { if (mounted.current) setReading((n) => n - 1); }
  };
  const addReferenceImage = (image: ChatAttachment) => {
    void referenceImageAttachment(props.app, image).then((file) => {
      addAttachment(file);
      textarea.current?.focus();
    }).catch((error) => setAttachmentError(error instanceof Error ? error.message : String(error)));
  };
  useEffect(() => {
    if (!props.prefillVersion) return;
    setInput(props.prefill); textarea.current?.focus();
  }, [props.prefill, props.prefillVersion]);
  useEffect(() => { if (props.focusVersion) textarea.current?.focus(); }, [props.focusVersion]);
  // Arrow keys move through a menu that scrolls; keep the active option in view.
  useEffect(() => {
    if (menuOpen) textarea.current?.ownerDocument.getElementById(`${inputId}-option-${menuIndex}`)?.scrollIntoView?.({ block: "nearest" });
  }, [menuOpen, menuIndex, inputId]);
  const runAdd = (kind: AddKind) => {
    if (kind === "upload") upload.current?.click();
    else (kind === "file" ? props.onPickFile : props.onPickFolder)(addAttachment);
  };
  // Only a new request runs the action; re-renders with the same version do not.
  useEffect(() => { if (props.addRequest?.version) runAdd(props.addRequest.kind); }, [props.addRequest?.version]);
  useEffect(() => {
    const el = textarea.current;
    if (el) { el.style.removeProperty("height"); el.style.setProperty("height", `${Math.min(el.scrollHeight, 180)}px`); }
  }, [input]);

  const submit = async (text: string, prompt?: SentPrompt) => {
    if ((!text.trim() && !attachments.length) || reading || running || locked.current) return;
    if (imageEditing && !text.trim()) { setAttachmentError("请描述希望如何修改图片"); textarea.current?.focus(); return; }
    try { props.onValidateAttachments(attachments); } catch (e) { setAttachmentError(e instanceof Error ? e.message : String(e)); return; }
    locked.current = true; clearError(); setStopped(false); setInput("");
    const sent = attachments; setAttachments([]); setAttachmentError("");
    try { await sendMessage({ text: text.trim() || "请分析这些附件。", metadata: { createdAt: Date.now(), sourcePath: props.note?.path, attachments: sent, ...(prompt ? { prompt } : {}) } }); }
    finally { locked.current = false; await props.onPersist(); }
  };
  // Qiaomu Home sends a question the user already submitted there; runs once per request, after the draft is set.
  useEffect(() => { if (props.submitVersion && props.prefill.trim()) void submit(props.prefill); }, [props.submitVersion]);
  const retry = async () => {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser) return;
    // A retry is explicit, not an automatic replay of possibly side-effecting tools.
    setInput(messageText(lastUser)); setAttachments(lastUser.metadata?.attachments ?? []); clearError(); textarea.current?.focus();
  };
  const beginEdit = (message: AgentMessage) => {
    setEditingId(message.id); setEditText(messageText(message));
  };
  const submitEdit = async (message: AgentMessage) => {
    const text = editText.trim();
    if (!text || running || locked.current) return;
    locked.current = true; clearError(); setStopped(false);
    props.onEditMessage();
    setMessages((current) => {
      const index = current.findIndex((item) => item.id === message.id);
      if (index < 0) return current;
      const edited = { ...message, parts: message.parts.map((part) => part.type === "text" ? { ...part, text } : part) };
      return [...current.slice(0, index), edited];
    });
    setEditingId(null);
    try { await regenerate({ messageId: message.id }); }
    finally { locked.current = false; await props.onPersist(); }
  };
  const title = messages.find((m) => m.role === "user");
  const images = conversationImages(messages);
  const imageFromElement = (element: HTMLImageElement, index: number): ChatAttachment => {
    const id = element.closest("[data-qa-image-id]")?.getAttribute("data-qa-image-id");
    const existing = images.find((item) => item.id === id);
    if (existing) return existing;
    const url = element.currentSrc || element.src;
    const name = element.alt || `图片 ${index + 1}`;
    const mediaType = /^data:(image\/[^;,]+)/.exec(url)?.[1] || (/\.jpe?g(?:[?#]|$)/i.test(url) ? "image/jpeg" : /\.webp(?:[?#]|$)/i.test(url) ? "image/webp" : /\.gif(?:[?#]|$)/i.test(url) ? "image/gif" : "image/png");
    return { id: `rendered-${index}`, name, mediaType, size: 0, url };
  };
  const openRenderedImage = (image: ChatAttachment, event: MouseEvent) => {
    const root = (event.target as Element).closest(".qa-conversation-content");
    const elements = root ? Array.from(root.querySelectorAll<HTMLImageElement>(".qa-message-content img")) : [];
    const rendered = elements.length ? elements.map(imageFromElement) : images;
    const identity = (item: ChatAttachment) => item.size ? `${item.name}:${item.size}` : item.url || item.id;
    const all = rendered.filter((item, index) => rendered.findIndex((candidate) => identity(candidate) === identity(item)) === index);
    const clicked = elements.findIndex((element) => element === event.target || element.closest("[data-qa-image-id]") === event.target);
    const selected = rendered[clicked] ?? rendered.find((item) => item.id === image.id || item.url === image.url) ?? image;
    new ConversationImageLightbox(props.app, all, all.find((item) => identity(item) === identity(selected)) ?? selected, props.imageTargetNote, addReferenceImage).open();
  };
  return <>
    <header className="qa-header">
      <div className="qa-title-wrap"><div className="qa-title"><TreeDeciduous className="qa-brand-icon" size={16} aria-hidden="true" /><span className="qa-brand">Agent</span>
          <span className="qa-conversation-title">{props.conversationTitle || (title ? messageText(title).split("\n")[0]?.slice(0, 60) : "新对话")}</span></div>
        {props.branch && <button type="button" className="qa-branch-parent" disabled={running} onClick={() => props.onOpenParent(props.branch!.parentId)}>
          <GitBranch size={12} /><span>返回原对话 · {props.branch.parentTitle}</span></button>}
      </div>
      <button type="button" disabled={running} onClick={(e) => props.onHistory(e.nativeEvent)}><History size={17} /><span className="qiaomu-agent__sr-only">历史对话</span></button>
      <button type="button" disabled={running} onClick={props.onNew}><SquarePen size={17} /><span className="qiaomu-agent__sr-only">新对话</span></button>
      <button type="button" onClick={props.onOpenSettings}><Settings size={17} /><span className="qiaomu-agent__sr-only">设置</span></button>
    </header>
    <Conversation>
      <ConversationContent onClick={(event) => {
        const image = event.target;
        if (!(image instanceof HTMLImageElement) || !image.closest(".qa-markdown-host")) return;
        event.preventDefault(); openRenderedImage(imageFromElement(image, 0), event.nativeEvent);
      }} onContextMenu={(event) => {
        const image = event.target;
        if (!(image instanceof HTMLImageElement) || !image.closest(".qa-markdown-host")) return;
        event.preventDefault(); showConversationImageMenu(props.app, imageFromElement(image, 0), event.nativeEvent, props.imageTargetNote, addReferenceImage);
      }}>
        {!messages.length && <EmptyState scene={scene} noModel={!props.sources.length} onConnect={props.onManageModels}
          prompts={stripPrompts(props.promptCatalog, props.promptSettings, scene).slice(0, 4)}
          onPick={(item) => void runPrompt(item)} />}
        {messages.filter((m) => m.role !== "system").map((message, index, visible) => {
          const text = messageText(message);
          const latest = index === visible.length - 1;
          const active = running && latest && message.role === "assistant";
          const assistant = message.role === "assistant";
          const changes = message.parts.find((p) => p.type === "data-changes");
          const messageAttachments = new Map((message.metadata?.attachments ?? []).map((attachment) => [attachment.id, attachment]));
          for (const part of message.parts) if (part.type === "data-attachment") messageAttachments.set(part.data.id, part.data);
          return <Message key={message.id} from={message.role} className={`${editingId === message.id ? "is-editing" : ""}${latest ? " is-latest" : ""}`}>
            <MessageContent>
              <Attachments files={[...messageAttachments.values()]} variant={message.role === "assistant" ? "grid" : "inline"}
                onOpenImage={openRenderedImage}
                onImageMenu={(image, event) => showConversationImageMenu(props.app, image, event, props.imageTargetNote, addReferenceImage)} />
              {message.role === "user" && editingId === message.id ? <form className="qa-message-editor" onSubmit={(event) => { event.preventDefault(); void submitEdit(message); }}>
                <label className="qiaomu-agent__sr-only" htmlFor={`${inputId}-edit-${message.id}`}>编辑消息内容</label>
                <textarea id={`${inputId}-edit-${message.id}`} value={editText} onChange={(event) => setEditText(event.currentTarget.value)} autoFocus rows={3}
                  onKeyDown={(event) => { if (Platform.isDesktopApp && event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submitEdit(message); } }} />
                <div className="qa-message-editor-actions"><button type="button" onClick={() => setEditingId(null)}>取消</button><button type="submit" className="mod-cta" disabled={!editText.trim()}>发送</button></div>
              </form> : assistant ? <ReplyTimeline message={message} active={active} statusText={props.statusText}
                renderText={(segment) => <NoteMarkdown text={segment} sourcePath={message.metadata?.sourcePath ?? ""} app={props.app} parent={props.parent} />}
                renderApproval={(approval) => <ApprovalCard approval={approval} onChoose={(choice) => props.onApprove(approval.id, choice)} />}
                renderQuestion={(question) => <QuestionCard state={question} onAnswer={(answers) => props.onAnswer(question.id, answers)} />} />
                : message.metadata?.prompt ? <SentPromptView prompt={message.metadata.prompt} text={text} />
                : text ? <NoteMarkdown text={text} sourcePath={message.metadata?.sourcePath ?? ""} app={props.app} parent={props.parent} /> : null}
              {assistant && !active && !text && !message.parts.some((p) => p.type === "data-activity" || p.type === "data-question" || p.type === "file") && <div className="qa-thinking">没有文本回复</div>}
              {changes?.type === "data-changes" && changes.data.files.length > 0 && <ChangeSummary changes={changes.data} disabled={running}
                onOpen={props.onOpenFile} onRevert={() => props.onRevertChanges(message.id)} />}
            </MessageContent>
            {message.role === "user" && text && editingId !== message.id && <div className="qa-user-message-meta">
              <time dateTime={new Date(message.metadata?.createdAt ?? Date.now()).toISOString()}>{messageTime.format(message.metadata?.createdAt ?? Date.now())}</time>
              <MessageActions>
                <MessageAction label="复制消息" onClick={() => void navigator.clipboard.writeText(text).then(() => new Notice("已复制")).catch(() => new Notice("复制失败，请手动选择文本"))}><Copy size={14} /></MessageAction>
                <MessageAction label="编辑消息" disabled={running} onClick={() => beginEdit(message)}><Pencil size={14} /></MessageAction>
              </MessageActions>
            </div>}
            {message.role === "assistant" && text && !active && <MessageActions>
              <MessageAction label="复制回复" onClick={() => void navigator.clipboard.writeText(text).then(() => new Notice("已复制")).catch(() => new Notice("复制失败，请手动选择文本"))}><Copy size={14} /></MessageAction>
              <MessageAction label="从这条回复创建分支" disabled={running} onClick={() => props.onForkMessage(message.id)}><GitBranch size={14} /></MessageAction>
              <MessageAction label="追加到今日日记" onClick={() => props.onAppend(text, true)}><CalendarPlus size={14} /></MessageAction>
              <MessageAction label="追加到指定文件" onClick={() => props.onAppend(text, false)}><FilePlus2 size={14} /></MessageAction>
            </MessageActions>}
          </Message>;
        })}
        {running && messages.at(-1)?.role !== "assistant" && <WorkingStatus />}
        {stopped && !running && <div className="qa-thinking">已停止，已保留收到的内容。</div>}
        {error && <div className="qa-error" role="alert"><p>{error.message}</p><button type="button" onClick={() => void retry()}>编辑后重试</button><button type="button" onClick={props.onConnection}>检查连接</button></div>}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
    <div className="qa-composer">
      {messages.length > 0 && !promptForm && <PromptStrip catalog={props.promptCatalog} settings={props.promptSettings} scene={scene} disabled={running} actions={promptActions} />}
      {menuOpen && <div className="qa-command-menu" id={`${inputId}-menu`} role="listbox" aria-labelledby={`${inputId}-menu-label`}>
        <span id={`${inputId}-menu-label`} className="qiaomu-agent__sr-only">Prompt 菜单</span>
        {promptChoices.map((p, index) => [p.group !== promptChoices[index - 1]?.group && <div key={`group-${p.group}`} className="qa-command-group" aria-hidden="true">{p.group}</div>, <button type="button" role="option" aria-selected={index === menuIndex} id={`${inputId}-option-${index}`} key={p.id} onMouseDown={(e) => e.preventDefault()} onClick={(event) => choosePrompt(index, event.shiftKey)}><Slash size={15} /><span>{p.title}</span></button>])}
        {!promptChoices.length && <div className="qa-command-empty">没有匹配的 Prompt</div>}
        <button type="button" role="option" aria-selected={menuIndex === promptChoices.length} id={`${inputId}-option-${promptChoices.length}`} onMouseDown={(e) => e.preventDefault()} onClick={() => choosePrompt(promptChoices.length)}><Plus size={15} /><span>管理 Prompt 库…</span></button>
        {!Platform.isMobile && <div className="qa-command-hint" aria-hidden="true">↵ 发送 · ⇧↵ 填入输入框</div>}
      </div>}
      {attachmentError && <div className="qa-error" role="alert">{attachmentError}</div>}
      {promptForm && <PromptForm item={promptForm.item} fields={promptForm.fields} values={promptForm.values}
        onChange={(name, value) => setPromptForm((form) => form && { ...form, values: { ...form.values, [name]: value } })}
        onCancel={() => { setPromptForm(null); textarea.current?.focus(); }}
        onSubmit={() => { if (!running) void sendPrompt(promptForm.item, promptForm.values, promptForm.context, promptForm.draft); }} />}
      <PromptInput onSubmit={(event) => { event.preventDefault(); void submit(input); }} onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) e.preventDefault(); }} onDrop={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); void addFiles(Array.from(e.dataTransfer.files)); } }}>
        <input type="file" multiple hidden ref={upload} onChange={(e) => { void addFiles(Array.from(e.currentTarget.files ?? [])); e.currentTarget.value = ""; }} />
        <Attachments files={attachments} onRemove={(id) => setAttachments((current) => current.filter((a) => a.id !== id))} />
        {reading > 0 && <div className="qa-status">正在读取附件…</div>}
        {!imageEditing && (props.note || props.editorSelection || props.reading) && <PromptInputHeader>
          {props.note && <span className="qa-note"><FileText size={13} /><span>{props.note.basename}</span>
            <button type="button" disabled={running} onClick={props.onToggleNote}><X size={12} /><span className="qiaomu-agent__sr-only">不附加当前笔记</span></button></span>}
          {props.editorSelection && <span className="qa-note qa-selection-chip"><TextSelect size={13} /><span>{props.editorSelection.label}</span>
            <button type="button" disabled={running} onClick={props.onDismissSelection}><X size={12} /><span className="qiaomu-agent__sr-only">不附加选中的文字</span></button></span>}
          {props.reading && <span className="qa-note qa-reading-chip"><ReadingIcon chip={props.reading} /><span>{props.reading.label}</span>
            <button type="button" disabled={running} onClick={props.onDismissReading}><X size={12} /><span className="qiaomu-agent__sr-only">不附加正在阅读的内容</span></button></span>}
        </PromptInputHeader>}
        <label htmlFor={inputId} className="qiaomu-agent__sr-only">给 Agent 的消息</label>
        <PromptInputTextarea submitOnEnter={Platform.isDesktopApp} id={inputId} ref={textarea} value={input} onFocus={props.onComposerFocus} aria-controls={menuOpen ? `${inputId}-menu` : undefined} aria-activedescendant={menuOpen ? `${inputId}-option-${menuIndex}` : undefined}
          onKeyDown={(e) => {
            if (!menuOpen || e.nativeEvent.isComposing || e.keyCode === 229) return;
            if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setMenuIndex((n) => (n + (e.key === "ArrowDown" ? 1 : promptChoices.length)) % (promptChoices.length + 1)); }
            if (e.key === "Escape") {
              e.preventDefault(); setMenuDismissed(true);
              if (draftBeforePrompts.current !== null) { setInput(draftBeforePrompts.current); draftBeforePrompts.current = null; }
            }
            if (e.key === "Enter") { e.preventDefault(); choosePrompt(menuIndex, e.shiftKey); }
          }}
          onChange={(event) => {
            const value = event.currentTarget.value; const cursor = event.currentTarget.selectionStart;
            setInput(value); setMenuDismissed(false); setMenuIndex(0);
            if (!value.startsWith("/")) draftBeforePrompts.current = null;
            if (startsFileMention(value, cursor) && !(event.nativeEvent as InputEvent).isComposing) props.onPickFile((file) => { addAttachment(file); setInput((current) => current === value ? value.slice(0, cursor - 1) + value.slice(cursor) : current); textarea.current?.focus(); });
          }}
          onPaste={(e) => { const files = Array.from(e.clipboardData.files); if (files.length) { if (!e.clipboardData.getData("text/plain")) e.preventDefault(); void addFiles(files); } }}
          placeholder={imageEditing ? "描述要如何修改这张图片…" : scene === "vault" && Platform.isMobile ? "输入消息…" : PLACEHOLDERS[scene]} />
        <PromptInputFooter><PromptInputTools>
          <ComposerPopover label="添加附件与工具" trigger={<Plus size={18} />} iconOnly disabled={running}>
            {(close) => <div className="qa-add-menu">
              <div className="qa-add-group" role="group" aria-labelledby={`${inputId}-add`}>
                <div className="qa-add-heading" id={`${inputId}-add`}>添加</div>
                <button type="button" onClick={() => { close(); runAdd("upload"); }}><Paperclip size={16} /><span>文件或图片</span><span className="qa-add-hint">也可拖入</span><AddKey keys={props.addHotkeys?.upload} /></button>
                <button type="button" onClick={() => { close(); runAdd("file"); }}><FileText size={16} /><span>库内文件</span><AddKey keys={props.addHotkeys?.file || "@"} /></button>
                <button type="button" onClick={() => { close(); runAdd("folder"); }}><Folder size={16} /><span>库内文件夹</span><span className="qa-add-hint">附加其中的笔记</span><AddKey keys={props.addHotkeys?.folder} /></button>
                {props.onPickWebPage && <button type="button" onClick={() => { close(); props.onPickWebPage!(addAttachment); }}><Link size={16} /><span>网页</span><span className="qa-add-hint">读取正文</span></button>}
                {props.detachedNote && <button type="button" onClick={() => { close(); props.onToggleNote(); }}><FilePlus size={16} /><span>当前笔记</span><span className="qa-add-hint">{props.detachedNote.basename}</span></button>}
              </div>
              <div className="qa-add-group" role="group" aria-labelledby={`${inputId}-use`}>
                <div className="qa-add-heading" id={`${inputId}-use`}>使用</div>
                <button type="button" onClick={() => { close(); if (input && draftBeforePrompts.current === null) draftBeforePrompts.current = input; setInput("/"); setMenuDismissed(false); setMenuIndex(0); textarea.current?.focus(); }}><Slash size={16} /><span>Prompt</span><AddKey keys="/" /></button>
                {input.trim() && <button type="button" onClick={() => { close(); props.onManagePrompts(input); }}><BookOpen size={16} /><span>保存为 Prompt</span></button>}
                <button type="button" onClick={(event) => { close(); props.onSkill(event.nativeEvent); }}><Sparkles size={16} /><span>技能</span><span className="qa-add-hint">{props.skillLabel === "技能" ? "选择要用的技能" : props.skillLabel}</span><ChevronRight size={14} /></button>
                {props.webSearch !== undefined && <button type="button" aria-pressed={props.webSearch} onClick={props.onToggleWebSearch}><Globe size={16} /><span>联网搜索</span><span className="qa-add-hint">{props.webSearch ? "需要时自动搜索" : "已关闭"}</span><span className="qa-add-switch" aria-hidden="true" /></button>}
              </div>
            </div>}
          </ComposerPopover>
          {props.fileAccessAvailable && <ComposerPopover className={`qa-permission-control is-${imageEditing ? "plan" : props.permission}`} label={`访问权限：${permissionLabel}`} trigger={<PermissionIcon size={18} />} iconOnly disabled={running || imageEditing}>
            {(close) => <>
              <button type="button" aria-pressed={props.permission === "plan"} onClick={() => { close(); props.onPermission("plan"); }}><Shield size={16} /><span>只读</span>{props.permission === "plan" && <Check size={14} />}</button>
              <button type="button" aria-pressed={props.permission === "edit"} onClick={() => { close(); props.onPermission("edit"); }}><FolderPen size={16} /><span>可写当前库</span>{props.permission === "edit" && <Check size={14} />}</button>
              {Platform.isDesktopApp && props.fullAccessAvailable && <button type="button" className="qa-full-access" aria-pressed={props.permission === "full"} onClick={() => { close(); props.onPermission("full"); }}><ShieldAlert size={16} /><span>完全访问</span>{props.permission === "full" && <Check size={14} />}</button>}
            </>}
          </ComposerPopover>}
        </PromptInputTools>
        <ComposerPopover className="qa-model-control" label="模型与推理" disabled={running}
          trigger={<>{(() => { const source = props.sources.find((item) => item.key === props.selection?.source); return source ? <BrandIcon icon={source.icon} kind={source.kind} size={14} /> : null; })()}<span className="qa-model-name">{props.backendLabel}</span>{!!props.efforts.length && <span className="qa-effort-label">{effortLabel(props.effort)}<span className="qiaomu-agent__sr-only">推理强度</span></span>}<ChevronDown size={12} /></>}>
          {(close) => <ModelPicker sources={props.sources} current={props.selection} recent={props.recentModels}
            efforts={props.efforts} effort={props.effort} onEffort={props.onEffort}
            onSelect={(source, model) => { props.onPickModel(source, model); close(); }}
            onLoad={props.onLoadModels} onManage={() => { close(); props.onManageModels(); }} />}
        </ComposerPopover>
        {contextUsage && <ContextRing usage={contextUsage} onNew={props.onNew} disabled={running} />}
        <PromptInputSubmit status={status} disabled={(!input.trim() && !attachments.length) || reading > 0 || props.modelLoading} onStop={() => { setStopped(true); void stop().then(props.onPersist); }} />
        </PromptInputFooter>
      </PromptInput>
    </div>
  </>;
}

/** The most recent reply's reported context usage; older replies describe a smaller window. */
function latestUsage(messages: AgentMessage[]) {
  for (let index = messages.length - 1; index >= 0; index--) {
    const usage = messages[index]!.role === "assistant" ? messageUsage(messages[index]!) : undefined;
    if (usage) return usage;
  }
  return undefined;
}

/** A shortcut shown at the end of an add-menu row, like a native menu's key column. */
function AddKey({ keys }: { keys?: string }) {
  return keys ? <kbd className="qa-add-key" aria-hidden="true">{keys}</kbd> : null;
}

/** A message sent from a saved prompt: its title and what the user added; the full text folds away. */
function SentPromptView({ prompt, text }: { prompt: SentPrompt; text: string }) {
  return <div className="qa-sent-prompt">
    <div className="qa-sent-prompt-title"><Sparkles size={13} aria-hidden="true" /><span>{prompt.title}</span></div>
    {prompt.extra && <p className="qa-sent-prompt-extra">{prompt.extra}</p>}
    <details><summary>完整 Prompt</summary><div className="qa-sent-prompt-body">{text}</div></details>
  </div>;
}

/** Reading context from another plugin or view, shown as a removable composer chip. */
export interface ReadingChip { label: string; detail: string; kind: "article" | "book" | "document" | "page" | "other"; selected: boolean }

function ReadingIcon({ chip }: { chip: ReadingChip }) {
  if (chip.selected) return <TextSelect size={13} />;
  const Icon = { article: Newspaper, book: BookOpen, document: FileText, page: Globe, other: Shapes }[chip.kind];
  return <Icon size={13} />;
}

const PLACEHOLDERS: Record<StarterScene, string> = {
  selection: "要对选中的文字做什么？", reading: "关于正在读的内容，想问什么？", daily: "今天想记下或理清什么？",
  note: "问问这篇笔记，或让它帮你改…", vault: "输入消息，/ 调出 Prompt",
};

const SUBTITLES: Record<StarterScene, string> = {
  selection: "选中的文字会随消息发送；在笔记里换个选区，这里会跟着变。",
  reading: "正在读的内容会随消息发送，直接问就好。",
  daily: "今天的日记会随消息发送。",
  note: "当前笔记会随消息发送；不需要时，点输入框上方的 ×。",
  vault: "问问题、整理想法，或让它在库里帮你找笔记。",
};

/** The first screen of a conversation: what will be sent along, and a few prompts that fit it. */
function EmptyState(props: { scene: StarterScene; noModel: boolean; onConnect: () => void;
  prompts: PromptItem[]; onPick: (item: PromptItem) => void }) {
  const labelId = useId();
  if (props.noModel) return <div className="qa-empty">
    <h3>先连接一个模型</h3>
    <p>可以用本机已安装的 Agent，如 Claude Code、Codex；也可以填入模型服务的 API Key。</p>
    <button type="button" className="qa-empty-connect" onClick={props.onConnect}><Plug size={15} /><span>连接模型</span></button>
  </div>;
  const heading = { selection: "针对选中的文字", reading: "边读边聊", daily: "今天过得怎么样", note: "围绕这篇笔记", vault: "从一个想法开始" }[props.scene];
  return <div className="qa-empty">
    <h3>{heading}</h3>
    <p>{SUBTITLES[props.scene]}</p>
    <div className="qa-suggestions" role="group" aria-labelledby={labelId}>
      <span id={labelId} className="qiaomu-agent__sr-only">可以这样开始</span>
      {props.prompts.map((prompt) => <button key={prompt.id} type="button" onClick={() => props.onPick(prompt)}>
        {prompt.title}</button>)}
    </div>
    {!Platform.isMobile && <p className="qa-empty-keys"><span><kbd>/</kbd>更多 Prompt</span><span><kbd>@</kbd>引用文件</span><span><kbd>⇧</kbd><kbd>↵</kbd>换行</span></p>}
  </div>;
}
