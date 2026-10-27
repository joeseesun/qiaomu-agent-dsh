import type { ChatMessage, ConversationIdentity, ConversationRecord, QiaomuSettings } from "../types";

const MAX_HISTORY = 30;
const MAX_MESSAGES = 80;

export function conversationTitle(messages: ChatMessage[]): string {
  return messages.find((message) => message.role === "user")?.content.split("\n")[0]?.trim().slice(0, 60) || "对话";
}

function childTitle(parent: ConversationIdentity, number: number): string {
  const suffix = parent.fork && /( · 分支 \d+(?:\.\d+)*)$/.exec(parent.title);
  return suffix ? `${parent.title}.${number}`.slice(0, 80) : `${parent.title} · 分支 ${number}`.slice(0, 80);
}

/** Migrate titles produced by the first nested-fork implementation. */
export function normalizeBranchTitle<T extends ConversationIdentity>(identity: T): T {
  if (!identity.fork || !/( · 分支 \d+){2,}$/.test(identity.title)) return identity;
  const match = /^(.*?)(?: · 分支 (\d+)){2,}$/.exec(identity.title);
  if (!match) return identity;
  const numbers = [...identity.title.matchAll(/ · 分支 (\d+)/g)].map((item) => item[1]);
  return { ...identity, title: `${match[1]} · 分支 ${numbers.join(".")}` };
}

export function activeIdentity(settings: QiaomuSettings): ConversationIdentity {
  settings.activeConversation ??= { id: crypto.randomUUID(), title: "", createdAt: Date.now() };
  return settings.activeConversation;
}

function archiveCurrent(settings: QiaomuSettings, messages: ChatMessage[]): void {
  if (!messages.length) return;
  const active = activeIdentity(settings);
  const entry: ConversationRecord = { ...active, title: active.title || conversationTitle(messages), messages: messages.slice(-MAX_MESSAGES) };
  settings.conversations = [entry, ...(settings.conversations ?? []).filter((item) => item.id !== active.id)].slice(0, MAX_HISTORY);
}

/** Start a blank conversation while keeping the prior one reachable. */
export function startConversation(settings: QiaomuSettings, messages: ChatMessage[]): void {
  archiveCurrent(settings, messages);
  settings.activeConversation = { id: crypto.randomUUID(), title: "", createdAt: Date.now() };
}

/** Swap an archived conversation into the active slot without duplicating either record. */
export function openConversation(settings: QiaomuSettings, messages: ChatMessage[], id: string): ChatMessage[] | null {
  const target = settings.conversations?.find((item) => item.id === id);
  if (!target || activeIdentity(settings).id === id) return null;
  archiveCurrent(settings, messages);
  settings.conversations = (settings.conversations ?? []).filter((item) => item.id !== id);
  settings.activeConversation = { id: target.id, title: target.title, createdAt: target.createdAt, ...(target.fork ? { fork: target.fork } : {}) };
  return target.messages;
}

/** Fork only completed history through one assistant message; old file-change actions stay on the parent. */
export function forkConversation(settings: QiaomuSettings, messages: ChatMessage[], messageId: string): ChatMessage[] | null {
  const index = messages.findIndex((item) => item.id === messageId && item.role === "assistant");
  if (index < 0) return null;
  const parent = activeIdentity(settings);
  const parentTitle = parent.title || conversationTitle(messages);
  archiveCurrent(settings, messages);
  const siblingCount = (settings.conversations ?? []).filter((item) => item.fork?.parentId === parent.id).length;
  settings.activeConversation = {
    id: crypto.randomUUID(), title: childTitle({ ...parent, title: parentTitle }, siblingCount + 1), createdAt: Date.now(),
    fork: { parentId: parent.id, parentTitle, messageId },
  };
  return messages.slice(0, index + 1).map((message) => ({
    ...message, id: crypto.randomUUID(),
    attachments: message.attachments?.map((attachment) => ({ ...attachment })),
    // Changes belong to the original turn's file state; the fork must not offer their undo buttons.
    activities: undefined, changes: undefined,
  }));
}
