// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Chat } from "@ai-sdk/react";
import { ChatPanel } from "../src/ui/chat-panel";
import { AgentTransport, messageText, type AgentMessage } from "../src/services/chat-transport";
import { Platform, type App, type Component } from "obsidian";
import { normalizePromptSettings, promptCatalog } from "../src/services/prompt-library";
import type { ComponentProps, ReactNode } from "react";
vi.mock("obsidian", () => ({
  Component: class {}, Notice: class {}, Modal: class {}, MarkdownView: class {}, Menu: class {}, Setting: class {}, TFile: class {}, requestUrl: vi.fn(),
  Platform: { isDesktopApp: true },
  Keymap: { isModEvent: () => false },
  MarkdownRenderer: { render: async (_: unknown, text: string, target: HTMLElement) => { target.textContent = text; } },
}));
vi.mock("../src/components/ai-elements/conversation", () => ({
  Conversation: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ConversationContent: ({ children }: { children: ReactNode }) => <div>{children}</div>, ConversationScrollButton: () => null,
}));
afterEach(() => { cleanup(); Platform.isDesktopApp = true; });
function setup() {
  const send = vi.fn(async (_request, callbacks) => { callbacks.onText("测试回复"); });
  const chat = new Chat<AgentMessage>({ transport: new AgentTransport(async (messages) => ({ backend: { id: "mock", label: "Mock", send }, request: { prompt: messageText(messages.at(-1)!), systemPrompt: "", cwd: null, permissionMode: "plan", history: [], attachments: messages.at(-1)?.metadata?.attachments } })) });
  const props: ComponentProps<typeof ChatPanel> = {
    chat, app: {} as App, parent: { addChild() {}, removeChild() {} } as unknown as Component,
    conversationId: "test", conversationTitle: "", branch: null, onOpenParent: vi.fn(), onForkMessage: vi.fn(), imageTargetNote: null,
    backendLabel: "Mock", skillLabel: "技能", permission: "plan", fileAccessAvailable: true, fullAccessAvailable: true, note: null, statusText: "", prefill: "", prefillVersion: 0,
    sources: [{ key: "api:mock", kind: "api", label: "Mock 服务商", models: [{ id: "mock", name: "Mock model", efforts: ["low", "high"] }, { id: "other", name: "Other model", efforts: [] }], loaded: true }],
    selection: { source: "api:mock", model: "mock" }, recentModels: [], onPickModel: vi.fn(), onLoadModels: vi.fn(), onManageModels: vi.fn(),
    onConnection: vi.fn(), onNew: vi.fn(), onOpenSettings: vi.fn(), onHistory: vi.fn(), onSkill: vi.fn(), onPermission: vi.fn(), onEditMessage: vi.fn(), onToggleNote: vi.fn(), onPersist: async () => {}, onApprove: vi.fn(), onRevertChanges: vi.fn(), onOpenFile: vi.fn(), editorSelection: null, onDismissSelection: vi.fn(), onComposerFocus: vi.fn(),
    efforts: ["low", "high"], effort: "high", modelLoading: false, onEffort: vi.fn(), promptCatalog: promptCatalog([{ id: "p", title: "测试模板", body: "自定义内容", source: "user", path: "Qiaomu Agent/Prompts/测试模板.md" }]),
    promptSettings: normalizePromptSettings({}), onManagePrompts: vi.fn(), onPromptUsed: vi.fn(), onEditPrompt: vi.fn(), onTogglePromptPin: vi.fn(), onPickFile: vi.fn(), onPickFolder: vi.fn(), onValidateAttachments: vi.fn(), onAppend: vi.fn(),
  };
  const result = render(<ChatPanel {...props} />);
  return { ...result, props, send, chat, input: screen.getByLabelText("给 Agent 的消息") };
}
it("mobile Enter does not submit; the send button still works", async () => {
  Platform.isDesktopApp = false;
  const { input, send } = setup();
  fireEvent.change(input, { target: { value: "手机中文输入" } });
  expect(fireEvent.keyDown(input, { key: "Enter" })).toBe(true);
  expect(send).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
  await waitFor(() => expect(send).toHaveBeenCalledOnce());
});
it("slash Enter runs a prompt, Shift+Enter inserts it, Escape preserves the draft, and IME Enter does not send", async () => {
  const { input, send, props, container } = setup();
  fireEvent.change(input, { target: { value: "/测试" } });
  fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
  await waitFor(() => expect((input as HTMLTextAreaElement).value).toBe("自定义内容"));
  expect(send).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: "/" } }); fireEvent.keyDown(input, { key: "Escape" }); expect(screen.queryByRole("listbox")).toBeNull(); expect((input as HTMLTextAreaElement).value).toBe("/");
  fireEvent.compositionStart(input); fireEvent.keyDown(input, { key: "Enter", isComposing: true }); expect(send).not.toHaveBeenCalled(); fireEvent.compositionEnd(input);
  fireEvent.change(input, { target: { value: "/测试" } });
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(send).toHaveBeenCalledOnce());
  expect(send.mock.calls[0]![0].prompt).toBe("自定义内容");
  expect(props.onPromptUsed).toHaveBeenCalledWith("p");
  // The transcript names the prompt and folds its full text away.
  expect(container.querySelector(".qa-sent-prompt-title")!.textContent).toBe("测试模板");
});
it("the empty conversation offers prompts for what is on screen, runs them in one click, and asks for blanks first", async () => {
  const { input, props, rerender, send, chat } = setup();
  expect(screen.getByRole("heading", { name: "从一个想法开始" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "全部 Prompt" })).toBeNull();
  const pinned = normalizePromptSettings({ pinned: ["p"] });
  rerender(<ChatPanel {...props} promptSettings={pinned} editorSelection={{ label: "选中 2 行 · 草稿", detail: "x" }} />);
  expect(screen.getByRole("heading", { name: "针对选中的文字" })).toBeTruthy();
  const offered = screen.getByRole("group", { name: "可以这样开始" }).querySelectorAll("button");
  expect([...offered].map((b) => b.textContent)).toEqual(["测试模板", "润色这段", "讲明白这段", "压缩到一半"]);
  rerender(<ChatPanel {...props} />);
  // Typed text fills the blank; Enter sends without touching the composer again.
  fireEvent.change(input, { target: { value: "Obsidian 插件" } });
  fireEvent.click(screen.getByRole("button", { name: "在库里找笔记…" }));
  const blank = await screen.findByLabelText("主题");
  expect((blank as HTMLTextAreaElement).value).toBe("Obsidian 插件");
  fireEvent.keyDown(blank, { key: "Enter" });
  await waitFor(() => expect(send).toHaveBeenCalledOnce());
  expect(send.mock.calls[0]![0].prompt).toMatch(/^在我的库里找和「Obsidian 插件」有关的笔记/);
  await waitFor(() => expect(chat.status).toBe("ready"));
  expect((input as HTMLTextAreaElement).value).toBe("");
  // Once the conversation runs, the strip sends pinned prompts with what is typed alongside.
  rerender(<ChatPanel {...props} promptSettings={pinned} />);
  fireEvent.change(input, { target: { value: "补充一句" } });
  fireEvent.click(screen.getByRole("button", { name: "测试模板" }));
  await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  expect(send.mock.calls[1]![0].prompt).toBe("自定义内容\n\n补充一句");
  await waitFor(() => expect(chat.status).toBe("ready"));
  fireEvent.click(screen.getByRole("button", { name: "全部 Prompt" }));
  fireEvent.change(screen.getByRole("combobox", { name: "搜索 Prompt" }), { target: { value: "周回顾" } });
  expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["做一次周回顾"]);
  fireEvent.click(screen.getByRole("button", { name: "管理 Prompt 库" }));
  expect(props.onManagePrompts).toHaveBeenCalledOnce();
});
it("without any model the empty conversation leads to connecting one", () => {
  const { props, rerender } = setup();
  rerender(<ChatPanel {...props} sources={[]} />);
  fireEvent.click(screen.getByRole("button", { name: "连接模型" }));
  expect(props.onManageModels).toHaveBeenCalledOnce();
  expect(screen.queryByRole("group", { name: "可以这样开始" })).toBeNull();
});
it("the Prompt menu puts fitting and own prompts first and searches every enabled one", async () => {
  const { input } = setup();
  fireEvent.change(input, { target: { value: "/" } });
  const menu = screen.getByRole("listbox", { name: "Prompt 菜单" });
  expect([...menu.querySelectorAll(".qa-command-group")].map((g) => g.textContent).slice(0, 2)).toEqual(["适合现在", "我的"]);
  fireEvent.change(input, { target: { value: "/润色" } });
  expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["润色这段", "管理 Prompt 库…"]);
  fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
  await waitFor(() => expect((input as HTMLTextAreaElement).value).toMatch(/^润色选中的文字/));
});
it("save current draft opens Prompt editor and leaves the draft untouched", () => {
  const { input, props } = setup();
  fireEvent.change(input, { target: { value: "请总结这份笔记" } });
  fireEvent.click(screen.getByRole("button", { name: "添加附件与工具" }));
  fireEvent.click(screen.getByRole("button", { name: "保存为 Prompt" }));
  expect(props.onManagePrompts).toHaveBeenCalledWith("请总结这份笔记");
  expect((input as HTMLTextAreaElement).value).toBe("请总结这份笔记");
});
it("pasted images become removable attachments and reach the request", async () => {
  const { input, container, send, chat, props } = setup();
  const image = new File([new Uint8Array([1, 2, 3])], "test.png", { type: "image/png" });
  fireEvent.paste(input, { clipboardData: { files: [image], getData: () => "" } });
  await screen.findByRole("button", { name: "移除 test.png" });
  await waitFor(() => expect(screen.queryByText("正在读取附件…")).toBeNull());
  fireEvent.submit(container.querySelector("form")!);
  await waitFor(() => expect(send).toHaveBeenCalledOnce());
  await waitFor(() => expect(chat.status).toBe("ready"));
  expect(send.mock.calls[0]![0].attachments[0].url).toMatch(/^data:image\/png;base64,/);
  expect(screen.getByRole("button", { name: "追加到今日日记" }).textContent).toBe("追加到今日日记");
});
it("unsupported file upload is explicit and does not erase text", async () => {
  const { input, container } = setup(); fireEvent.change(input, { target: { value: "保留草稿" } });
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(["data"], "bad.exe")] } });
  await screen.findByRole("alert"); expect((input as HTMLTextAreaElement).value).toBe("保留草稿");
});
it("model/effort actions and icon-only reply actions invoke the right callbacks", async () => {
  const { input, container, props } = setup();
  fireEvent.click(document.querySelector(".qa-model-control .qa-control-trigger")!);
  expect(container.querySelector(".lucide-brain")).toBeNull();
  expect(container.querySelector(".qa-effort-label")).toBeTruthy();
  fireEvent.click(screen.getByRole("radio", { name: "低" })); expect(props.onEffort).toHaveBeenCalledWith("low");
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Other model" }));
  expect(props.onPickModel).toHaveBeenCalledWith("api:mock", "other");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByText("仅建议")).toBeNull();
  expect(screen.queryByText("🧠")).toBeNull();
  fireEvent.change(input, { target: { value: "hello" } }); fireEvent.submit(container.querySelector("form")!);
  fireEvent.click(await screen.findByRole("button", { name: "追加到指定文件" })); expect(props.onAppend).toHaveBeenCalledWith("测试回复", false);
  fireEvent.click(screen.getByRole("button", { name: "从这条回复创建分支" })); expect(props.onForkMessage).toHaveBeenCalledOnce();
});

it("shows user time and can edit a message before regenerating its reply", async () => {
  const { input, container, send, chat, props } = setup();
  fireEvent.change(input, { target: { value: "原始问题" } }); fireEvent.submit(container.querySelector("form")!);
  await waitFor(() => expect(chat.status).toBe("ready"));
  expect(container.querySelector(".qa-user-message-meta time")?.textContent).toMatch(/^\d{2}:\d{2}$/);
  expect(screen.getByRole("button", { name: "复制消息" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "编辑消息" }));
  const editor = screen.getByLabelText("编辑消息内容");
  fireEvent.change(editor, { target: { value: "修改后的问题" } });
  fireEvent.submit(editor.closest("form")!);
  expect((screen.getByRole("button", { name: "编辑消息" }) as HTMLButtonElement).disabled).toBe(true);
  await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(chat.status).toBe("ready"));
  expect(send.mock.calls[1]![0].prompt).toBe("修改后的问题");
  expect(props.onEditMessage).toHaveBeenCalledOnce();
  expect(screen.queryByLabelText("编辑消息内容")).toBeNull();
});

it("composer popovers close with Escape, outside click and focus departure without losing draft", () => {
  const { input, props } = setup();
  fireEvent.change(input, { target: { value: "保留草稿" } });
  const trigger = screen.getByRole("button", { name: "添加附件与工具" });
  fireEvent.click(trigger);
  expect(screen.getByRole("button", { name: /文件或图片/ })).toBe(document.activeElement);
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull(); expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger); fireEvent.pointerDown(input); expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(trigger); fireEvent.click(screen.getByRole("button", { name: /^库内文件(?!夹)/ }));
  expect(props.onPickFile).toHaveBeenCalledOnce(); expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(trigger); fireEvent.blur(screen.getByRole("button", { name: /文件或图片/ }), { relatedTarget: input });
  expect(screen.queryByRole("dialog")).toBeNull(); expect((input as HTMLTextAreaElement).value).toBe("保留草稿");
});

it("add menu opens the prompt list and folder picker, keeping the draft on Escape", () => {
  const { input, props } = setup();
  fireEvent.change(input, { target: { value: "保留草稿" } });
  const trigger = screen.getByRole("button", { name: "添加附件与工具" });
  fireEvent.click(trigger); fireEvent.click(screen.getByRole("button", { name: /库内文件夹/ }));
  expect(props.onPickFolder).toHaveBeenCalledOnce();
  fireEvent.click(trigger); fireEvent.click(screen.getByRole("button", { name: /^Prompt/ }));
  expect((input as HTMLTextAreaElement).value).toBe("/");
  expect(screen.getByRole("listbox", { name: "Prompt 菜单" })).toBeTruthy();
  fireEvent.keyDown(input, { key: "Escape" });
  expect((input as HTMLTextAreaElement).value).toBe("保留草稿");
});

it("runs add commands once per request and shows bound hotkeys", () => {
  const { props, rerender } = setup();
  rerender(<ChatPanel {...props} addRequest={{ kind: "folder", version: 1 }} addHotkeys={{ folder: "⇧⌘F" }} />);
  rerender(<ChatPanel {...props} addRequest={{ kind: "folder", version: 1 }} addHotkeys={{ folder: "⇧⌘F" }} />);
  expect(props.onPickFolder).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "添加附件与工具" }));
  expect(screen.getByRole("button", { name: /库内文件夹/ }).textContent).toContain("⇧⌘F");
});

it("shows web page and web search only where they work", () => {
  const { props, rerender } = setup();
  const trigger = screen.getByRole("button", { name: "添加附件与工具" });
  fireEvent.click(trigger);
  expect(screen.queryByRole("button", { name: /网页/ })).toBeNull();
  expect(screen.queryByRole("button", { name: /联网搜索/ })).toBeNull();
  const onPickWebPage = vi.fn(); const onToggleWebSearch = vi.fn();
  rerender(<ChatPanel {...props} onPickWebPage={onPickWebPage} webSearch={true} onToggleWebSearch={onToggleWebSearch} />);
  const search = screen.getByRole("button", { name: /联网搜索/ });
  expect(search.getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(search);
  expect(onToggleWebSearch).toHaveBeenCalledOnce();
  expect(screen.getByRole("dialog")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /网页/ }));
  expect(onPickWebPage).toHaveBeenCalledOnce();
});

it("offers scoped and full access from a dedicated icon control", () => {
  const { props, rerender, container } = setup();
  fireEvent.click(screen.getByRole("button", { name: "访问权限：只读" }));
  expect(screen.getByRole("button", { name: "只读" }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("button", { name: "可写当前库" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "完全访问" }));
  expect(props.onPermission).toHaveBeenCalledWith("full");
  rerender(<ChatPanel {...props} permission="full" />);
  expect(screen.getByRole("button", { name: "访问权限：完全访问" })).toBeTruthy();
  expect(container.querySelector(".qa-permission-control .lucide-shield-alert")).toBeTruthy();
  expect(screen.queryByText("仅建议")).toBeNull();
});

it("does not offer desktop full-filesystem access on mobile", () => {
  Platform.isDesktopApp = false;
  setup();
  fireEvent.click(screen.getByRole("button", { name: "访问权限：只读" }));
  expect(screen.queryByRole("button", { name: "完全访问" })).toBeNull();
});

it("does not imply that a plain model API has local file tools", () => {
  const { props, rerender } = setup();
  rerender(<ChatPanel {...props} fileAccessAvailable={false} />);
  fireEvent.click(screen.getByRole("button", { name: "添加附件与工具" }));
  expect(screen.queryByText("访问权限")).toBeNull();
  expect(screen.queryByRole("button", { name: "可写当前库" })).toBeNull();
  expect(screen.queryByRole("button", { name: /访问权限：/ })).toBeNull();
});

it("does not invent reasoning capabilities and keeps controls available while loading", () => {
  const { props, rerender } = setup();
  rerender(<ChatPanel {...props} efforts={[]} />);
  fireEvent.click(document.querySelector(".qa-model-control .qa-control-trigger")!);
  expect(screen.queryByRole("radiogroup", { name: "推理强度" })).toBeNull();
  rerender(<ChatPanel {...props} modelLoading />);
  expect(screen.queryByRole("dialog")).not.toBeNull();
  expect((document.querySelector(".qa-model-control .qa-control-trigger")! as HTMLButtonElement).disabled).toBe(false);
});

it("shows an approval card that resolves the agent's request, and a reviewable change summary", async () => {
  const { props, chat, rerender } = setup();
  chat.messages = [
    { id: "u", role: "user", metadata: { createdAt: 1 }, parts: [{ type: "text", text: "改一下" }] },
    { id: "a", role: "assistant", metadata: { createdAt: 2 }, parts: [
      { type: "text", text: "已修改" },
      { type: "data-approval", id: "p1", data: { id: "p1", title: "Codex 请求执行命令", detail: "npm test", status: "pending", options: [
        { id: "reject_once", label: "拒绝", kind: "reject_once" }, { id: "allow_once", label: "允许一次", kind: "allow_once" }] } },
      { type: "data-changes", id: "changes", data: { files: [
        { path: "notes/a.md", before: "one\ntwo\n", after: "one\n2\n", tracked: true },
        { path: "shell.md", before: null, after: "x", tracked: false },
      ] } },
    ] },
  ];
  rerender(<ChatPanel {...props} />);
  const card = await screen.findByRole("group", { name: "Codex 请求执行命令" });
  expect(card.textContent).toContain("npm test");
  const buttons = Array.from(card.querySelectorAll("button")).map((b) => b.textContent);
  expect(buttons).toEqual(["允许一次", "拒绝"]);
  fireEvent.click(screen.getByRole("button", { name: "允许一次" }));
  expect(props.onApprove).toHaveBeenCalledWith("p1", "allow_once");
  expect(screen.getByText("修改了 2 个文件")).toBeTruthy();
  expect(screen.getByText("没有记录到修改前的内容，无法显示差异或自动恢复。")).toBeTruthy();
  expect(document.querySelector(".qa-diff")!.textContent).toContain("− two");
  fireEvent.click(screen.getByRole("button", { name: /撤销这些修改/ }));
  expect(props.onRevertChanges).toHaveBeenCalledWith("a");
  fireEvent.click(screen.getAllByRole("button", { name: "打开文件" })[0]!);
  expect(props.onOpenFile).toHaveBeenCalledWith("notes/a.md");
});

it("shows the editor selection as removable context and refreshes it on focus", () => {
  const { props, rerender, input } = setup();
  rerender(<ChatPanel {...props} editorSelection={{ label: "选中 3 行 · 草稿", detail: "第一行" }} />);
  expect(screen.getByText("选中 3 行 · 草稿")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "不附加选中的文字" }));
  expect(props.onDismissSelection).toHaveBeenCalledOnce();
  fireEvent.focus(input);
  expect(props.onComposerFocus).toHaveBeenCalled();
});

it("shows reading context from another plugin as a removable chip and focuses without clearing the draft", async () => {
  const { props, rerender, input } = setup();
  fireEvent.change(input, { target: { value: "写到一半的问题" } });
  const reading = { label: "选中 12 字 · 深度工作", detail: "乔木 RSS · 深度工作\n\n一段话", kind: "article" as const, selected: true };
  const onDismissReading = vi.fn();
  rerender(<ChatPanel {...props} reading={reading} onDismissReading={onDismissReading} focusVersion={1} />);
  expect(screen.getByText("选中 12 字 · 深度工作").closest(".qa-reading-chip")?.hasAttribute("title")).toBe(false);
  await waitFor(() => expect(document.activeElement).toBe(input));
  expect((input as HTMLTextAreaElement).value).toBe("写到一半的问题");
  fireEvent.click(screen.getByRole("button", { name: "不附加正在阅读的内容" }));
  expect(onDismissReading).toHaveBeenCalledOnce();
});
it("shows progress in the reply placeholder, then marks the finished reply as latest", async () => {
  const { input, send, chat, container } = setup();
  let finish!: () => void;
  send.mockImplementationOnce(async (_request, callbacks) => {
    callbacks.onActivity({ id: "read", label: "读取笔记", status: "running" });
    await new Promise<void>((resolve) => { finish = resolve; });
    callbacks.onText("完成");
  });
  fireEvent.change(input, { target: { value: "你好" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(await screen.findByText("读取笔记")).toBeTruthy();
  expect(screen.getByRole("status")).toBeTruthy();
  finish();
  await waitFor(() => expect(chat.status).toBe("ready"));
  const replies = container.querySelectorAll(".qa-message.is-assistant");
  expect(replies[replies.length - 1]!.classList.contains("is-latest")).toBe(true);
});
it("shows access as an icon whose accessible name carries the current level", () => {
  const { rerender, props } = setup();
  expect(screen.getByRole("button", { name: "访问权限：只读" })).toBeTruthy();
  rerender(<ChatPanel {...props} permission="edit" />);
  const trigger = screen.getByRole("button", { name: "访问权限：可写当前库" });
  expect(trigger.textContent).toBe("");
  expect(document.querySelector(".qa-permission-control.is-edit")).toBeTruthy();
});
it("shows the context ring only after a reported usage, warning near the limit", async () => {
  const { input, send, chat, props } = setup();
  expect(screen.queryByRole("button", { name: /上下文已用/ })).toBeNull();
  send.mockImplementationOnce(async (_request, callbacks) => { callbacks.onText("好"); callbacks.onUsage({ used: 170_000, size: 200_000 }); });
  fireEvent.change(input, { target: { value: "你好" } });
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(chat.status).toBe("ready"));
  fireEvent.click(await screen.findByRole("button", { name: "上下文已用 85%" }));
  expect(screen.getByText("170K / 200K tokens")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "新建对话" }));
  expect(props.onNew).toHaveBeenCalledOnce();
});
it("header shows the brand and opens plugin settings", () => {
  const { props } = setup();
  expect(screen.getByText("Agent")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "设置" }));
  expect(props.onOpenSettings).toHaveBeenCalled();
});
it("shows work in order while running, then folds it into 已处理 with the final answer in view", async () => {
  const { input, send, chat, container } = setup();
  let finish!: () => void;
  send.mockImplementationOnce(async (_request, callbacks) => {
    callbacks.onText("我先找歌单。");
    callbacks.onActivity({ id: "s1", label: "搜索 歌单", status: "completed", kind: "explore", actions: [{ type: "search", target: "歌单" }] });
    callbacks.onActivity({ id: "s2", label: "读取 a.md", status: "running", kind: "explore", actions: [{ type: "read", target: "a.md" }] });
    await new Promise<void>((resolve) => { finish = resolve; });
    callbacks.onActivity({ id: "s2", label: "读取 a.md", status: "completed", kind: "explore", actions: [{ type: "read", target: "a.md" }] });
    callbacks.onActivity({ id: "c1", label: "npm test", status: "completed", kind: "command", detail: "$ npm test\nok" });
    callbacks.onText("已添加到歌单。");
  });
  fireEvent.change(input, { target: { value: "加歌" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(await screen.findByText("正在探索…")).toBeTruthy();
  expect((container.querySelector(".qa-live-work") as HTMLDetailsElement).open).toBe(false);
  expect(container.querySelectorAll("[role=status]")).toHaveLength(1);
  expect(screen.queryByText("正在连接…")).toBeNull();
  expect(screen.getByText("我先找歌单。")).toBeTruthy();
  finish();
  await waitFor(() => expect(chat.status).toBe("ready"));
  const worked = container.querySelector(".qa-worked") as HTMLDetailsElement;
  expect(worked.querySelector("summary")!.textContent).toMatch(/^已处理 \d+ 秒$/);
  expect(worked.open).toBe(false);
  expect(worked.textContent).toContain("我先找歌单。");
  expect(worked.textContent).toContain("已探索1 个文件，1 次搜索");
  expect(worked.textContent).toContain("已运行npm test");
  expect(container.querySelector(".qa-worked + .qa-reply-segment")!.textContent).toBe("已添加到歌单。");
});
