// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Chat } from "@ai-sdk/react";
import type { ComponentProps } from "react";
import { ChatPanel } from "../upstream/qiaomu-agent/src/ui/chat-panel";
import { AgentTransport, messageText, type AgentMessage } from "../upstream/qiaomu-agent/src/services/chat-transport";
import { normalizePromptSettings } from "../upstream/qiaomu-agent/src/services/prompt-library";
import { Component } from "../src/client/obsidian";
import { NativeChatProjection } from "../src/client/native-chat";

beforeEach(() => {
  // jsdom has no layout engine. Only the observer boundary is stubbed; real original components render.
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function setup() {
  const parent = new Component(); parent.load();
  const openLinkText = vi.fn();
  const send = vi.fn(async (_request, callbacks) => { callbacks.onText("# 原版回答\n\n[[笔记|打开笔记]]"); });
  const chat = new Chat<AgentMessage>({ transport: new AgentTransport(async messages => ({
    backend: { id: "fixture", label: "Fixture", send },
    request: { prompt: messageText(messages.at(-1)!), systemPrompt: "", cwd: null, permissionMode: "plan", history: [] },
  })) });
  type Props = ComponentProps<typeof ChatPanel>;
  const app = { workspace: { openLinkText }, vault: { adapter: {}, getFiles: () => [] }, metadataCache: { getFirstLinkpathDest: () => null } } as unknown as Props["app"];
  const props: Props = {
    chat, app, parent: parent as unknown as Props["parent"], conversationId: "fixture", conversationTitle: "原版会话", branch: null,
    onOpenParent: vi.fn(), onForkMessage: vi.fn(), imageTargetNote: null, backendLabel: "Harness", skillLabel: "技能", permission: "plan",
    fileAccessAvailable: true, fullAccessAvailable: false, note: null, statusText: "", prefill: "", prefillVersion: 0,
    sources: [], selection: null, recentModels: [], onPickModel: vi.fn(), onLoadModels: vi.fn(), onManageModels: vi.fn(),
    onConnection: vi.fn(), onNew: vi.fn(), onOpenSettings: vi.fn(), onHistory: vi.fn(), onSkill: vi.fn(), onPermission: vi.fn(),
    onEditMessage: vi.fn(), onToggleNote: vi.fn(), onPersist: async () => {}, onApprove: vi.fn(), onAnswer: vi.fn(), onRevertChanges: vi.fn(), onOpenFile: vi.fn(),
    editorSelection: null, onDismissSelection: vi.fn(), onComposerFocus: vi.fn(), efforts: [], effort: "", modelLoading: false, onEffort: vi.fn(),
    promptCatalog: [], promptSettings: normalizePromptSettings({}), onManagePrompts: vi.fn(), onPromptUsed: vi.fn(), onEditPrompt: vi.fn(),
    onTogglePromptPin: vi.fn(), onPickFile: vi.fn(), onPickFolder: vi.fn(), onValidateAttachments: vi.fn(), onAppend: vi.fn(),
  };
  const view = render(<ChatPanel {...props} />);
  return { ...view, chat, send, openLinkText, parent };
}
it("runs the unchanged original composer, transport, Markdown and internal-link action against the new host boundary", async () => {
  const view = setup();
  fireEvent.change(screen.getByLabelText("给 Agent 的消息"), { target: { value: "我的问题" } });
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
  await waitFor(() => expect(screen.getByRole("heading", { name: "原版回答" })).toBeTruthy());
  expect(view.send).toHaveBeenCalledTimes(1);
  expect(view.container.querySelector(".qa-conversation")).not.toBeNull();
  fireEvent.click(screen.getByRole("link", { name: "打开笔记" }));
  expect(view.openLinkText).toHaveBeenCalledWith("笔记", "", false);
  view.unmount(); view.parent.unload();
});
it("renders authoritative native snapshot corrections through the original Chat UI", async () => {
  const view = setup(), projection = new NativeChatProjection();
  const update = (text: string) => {
    const node = { key: "native:a", kind: "assistant-step", data: { status: "settled", blocks: [{ kind: "text", text }] } };
    act(() => { view.chat.messages = projection.update({ order: [node.key], nodes: new Map([[node.key, node]]) }).messages; });
  };
  update("第一次内容");
  await waitFor(() => expect(screen.getByText("第一次内容")).toBeTruthy());
  update("纠正后的内容");
  await waitFor(() => expect(screen.getByText("纠正后的内容")).toBeTruthy());
  expect(screen.queryByText("第一次内容")).toBeNull();
  expect(view.send).not.toHaveBeenCalled();
  view.unmount(); view.parent.unload();
});
