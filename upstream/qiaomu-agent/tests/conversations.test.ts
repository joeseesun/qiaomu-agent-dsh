import { describe, expect, it } from "vitest";
import { normalizeSettings } from "../src/defaults";
import { forkConversation, openConversation, startConversation } from "../src/services/conversations";
import type { ChatMessage } from "../src/types";

const message = (id: string, role: "user" | "assistant", content: string): ChatMessage => ({ id, role, content, createdAt: 1 });

describe("conversation branching", () => {
  it("keeps the parent intact and copies only history through the selected reply", () => {
    const settings = normalizeSettings({});
    const original = [message("u1", "user", "提纲"), message("a1", "assistant", "方案 A"), message("u2", "user", "继续"),
      { ...message("a2", "assistant", "改了笔记"), changes: { files: [{ path: "note.md", before: "a", after: "b", tracked: true }] } }];
    const child = forkConversation(settings, original, "a1");
    expect(child?.map((item) => item.content)).toEqual(["提纲", "方案 A"]);
    expect(child?.map((item) => item.id)).not.toEqual(["u1", "a1"]);
    expect(settings.conversations?.[0]?.messages).toEqual(original);
    expect(settings.activeConversation?.fork?.messageId).toBe("a1");
    expect(settings.activeConversation?.fork?.parentId).toBe(settings.conversations?.[0]?.id);
  });

  it("does not carry file undo actions into a child and switches without duplicating history", () => {
    const settings = normalizeSettings({});
    const original = [message("u1", "user", "写笔记"), {
      ...message("a1", "assistant", "完成"),
      changes: { files: [{ path: "note.md", before: "a", after: "b", tracked: true }] },
      activities: [{ id: "tool", label: "写文件", status: "completed" as const }],
    }];
    const child = forkConversation(settings, original, "a1")!;
    expect(child[1]?.changes).toBeUndefined();
    expect(child[1]?.activities).toBeUndefined();
    const parentId = settings.activeConversation!.fork!.parentId;
    const childId = settings.activeConversation!.id;
    const restored = openConversation(settings, [...child, message("u2", "user", "试另一种")], parentId);
    expect(restored).toEqual(original);
    expect(settings.conversations?.filter((item) => item.id === childId)).toHaveLength(1);
    const again = openConversation(settings, restored!, childId);
    expect(again?.at(-1)?.content).toBe("试另一种");
    expect(settings.conversations?.filter((item) => item.id === parentId)).toHaveLength(1);
  });

  it("starts a new conversation without losing the current branch", () => {
    const settings = normalizeSettings({});
    const original = [message("u1", "user", "主题"), message("a1", "assistant", "回答")];
    forkConversation(settings, original, "a1");
    const branchId = settings.activeConversation!.id;
    startConversation(settings, original);
    expect(settings.activeConversation?.id).not.toBe(branchId);
    expect(settings.conversations?.some((item) => item.id === branchId)).toBe(true);
    expect(forkConversation(settings, original, "missing")).toBeNull();
  });
  it("uses compact hierarchical titles for a branch of a branch", () => {
    const settings = normalizeSettings({});
    const original = [message("u1", "user", "主题"), message("a1", "assistant", "回答")];
    const first = forkConversation(settings, original, "a1")!;
    const second = forkConversation(settings, first, first[1]!.id)!;
    expect(second).toHaveLength(2);
    expect(settings.activeConversation?.title).toBe("主题 · 分支 1.1");
    const legacy = normalizeSettings({ activeConversation: { ...settings.activeConversation, title: "主题 · 分支 1 · 分支 1" } });
    expect(legacy.activeConversation?.title).toBe("主题 · 分支 1.1");
  });
});
