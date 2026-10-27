import { expect, it } from "vitest";
import { AgentTransport, fromStoredMessage, toStoredMessage } from "../src/services/chat-transport";
import type { ChatRequest } from "../src/types";
const request: ChatRequest = { prompt: "hello", systemPrompt: "", cwd: null, permissionMode: "plan", history: [] };
const options = { chatId: "test", messages: [], trigger: "submit-message" as const, messageId: undefined, abortSignal: undefined };
it("streams SDK text and activity updates with stable identity", async () => {
  const transport = new AgentTransport(async () => ({ request, backend: { id: "test", label: "test", async send(_, c) {
    c.onText("你"); c.onText("好"); c.onActivity?.({ id: "a", label: "读取", status: "running" }); c.onActivity?.({ id: "a", label: "工具调用", status: "completed" });
  } } }));
  const reader = (await transport.sendMessages(options)).getReader(); const chunks = [];
  for (;;) { const item = await reader.read(); if (item.done) break; chunks.push(item.value); }
  expect(chunks.filter((c) => c.type === "text-delta").map((c) => c.delta).join("")).toBe("你好");
  expect(chunks.at(-1)).toMatchObject({ type: "finish" });
  expect(chunks.filter((c) => c.type === "data-activity").at(-1)).toMatchObject({ id: "a", data: { label: "读取", status: "completed" } });
});
it("imports generated media, streams a file part, and preserves a portable vault reference", async () => {
  const transport = new AgentTransport(async () => ({ request, backend: { id: "test", label: "test", async send(_, callbacks) {
    await callbacks.onAttachment?.({ id: "image-1", name: "小狗.png", mediaType: "image/png", size: 3, base64: "AQID" });
  } } }), async (generated) => ({
    id: generated.id, name: generated.name, mediaType: generated.mediaType, size: generated.size,
    vaultPath: ".qiaomu-agent/generated-images/image-1.png", url: "app://vault/image-1.png",
  }));
  const reader = (await transport.sendMessages(options)).getReader(); const chunks = [];
  for (;;) { const item = await reader.read(); if (item.done) break; chunks.push(item.value); }
  expect(chunks).toContainEqual({ type: "file", url: "app://vault/image-1.png", mediaType: "image/png" });
  expect(chunks.find((chunk) => chunk.type === "data-attachment")).toMatchObject({ data: { name: "小狗.png", vaultPath: ".qiaomu-agent/generated-images/image-1.png" } });

  const stored = toStoredMessage({
    id: "assistant", role: "assistant", metadata: { createdAt: 1 },
    parts: [{ type: "text", text: "完成" }, { type: "data-attachment", id: "image-1", data: { id: "image-1", name: "小狗.png", mediaType: "image/png", size: 3, vaultPath: ".qiaomu-agent/generated-images/image-1.png", url: "app://vault/image-1.png" } }],
  });
  expect(stored.attachments?.[0]).toMatchObject({ vaultPath: ".qiaomu-agent/generated-images/image-1.png", url: undefined });
  const restored = fromStoredMessage(stored, (attachment) => ({ ...attachment, url: "app://new-device/image-1.png" }));
  expect(restored.parts.find((part) => part.type === "file")).toMatchObject({ url: "app://new-device/image-1.png", mediaType: "image/png" });
});
it("surfaces prepare failures and pre-aborted requests", async () => {
  const transport = new AgentTransport(async () => { throw new Error("broken"); });
  const reader = (await transport.sendMessages(options)).getReader();
  expect((await reader.read()).value).toMatchObject({ type: "error", errorText: "broken" });
  const controller = new AbortController(); controller.abort();
  const cancelled = (await transport.sendMessages({ ...options, abortSignal: controller.signal })).getReader();
  expect((await cancelled.read()).value).toMatchObject({ type: "abort" });
});
it("preserves metadata and attachments across storage conversion", () => {
  const message = { id: "1", role: "user" as const, content: "hello", createdAt: 1, sourcePath: "中文.md", attachments: [{ id: "a", name: "a.txt", mediaType: "text/plain", size: 1, text: "a" }] };
  expect(toStoredMessage(fromStoredMessage(message))).toMatchObject(message);
});
it("closes promptly on abort even when the backend has not settled", async () => {
  let release!: () => void;
  const transport = new AgentTransport(async () => ({ request, backend: { id: "slow", label: "slow", send: () => new Promise<void>((resolve) => { release = resolve; }) } }));
  const controller = new AbortController();
  const reader = (await transport.sendMessages({ ...options, abortSignal: controller.signal })).getReader();
  expect((await reader.read()).value?.type).toBe("start");
  controller.abort(); expect((await reader.read()).value?.type).toBe("abort"); expect((await reader.read()).done).toBe(true);
  release();
});
it("carries approvals and the turn's file changes, and persists changes with a size budget", async () => {
  const change = { path: "a.md", before: "old", after: "new", tracked: true };
  const transport = new AgentTransport(async () => ({ request, backend: { id: "cli:test", label: "test", async send(_, c) {
    c.onFileIntent?.([{ path: "/v/a.md" }]);
    const chosen = await c.requestApproval?.({ id: "p1", title: "运行命令", options: [{ id: "allow_once", label: "允许一次", kind: "allow_once" }] });
    c.onText(`chosen:${chosen}`);
  } }, turn: { onFileIntent: () => undefined, awaitApproval: async () => "allow_once", finish: async () => [change] } }));
  const reader = (await transport.sendMessages(options)).getReader(); const chunks = [];
  for (;;) { const item = await reader.read(); if (item.done) break; chunks.push(item.value); }
  const approvals = chunks.filter((c) => c.type === "data-approval");
  expect(approvals.map((c) => (c as { data: { status: string } }).data.status)).toEqual(["pending", "decided"]);
  expect(chunks.find((c) => c.type === "data-changes")).toMatchObject({ id: "changes", data: { files: [change] } });
  expect(chunks.findIndex((c) => c.type === "data-changes")).toBeLessThan(chunks.findIndex((c) => c.type === "finish"));
  const big = "x".repeat(900_000);
  const stored = toStoredMessage({ id: "m", role: "assistant", metadata: { createdAt: 1 }, parts: [{ type: "text", text: "ok" },
    { type: "data-changes", id: "changes", data: { files: [change, { path: "big.md", before: big, after: big + "!", tracked: true }] } }] });
  expect(stored.changes?.files[0]).toEqual(change);
  expect(stored.changes?.files[1]).toMatchObject({ path: "big.md", tracked: false, before: null });
  expect(fromStoredMessage(stored).parts.find((p) => p.type === "data-changes")).toBeTruthy();
});
it("reports changes of a stopped turn after its stream closed", async () => {
  let late: unknown = null;
  const controller = new AbortController();
  const transport = new AgentTransport(async () => ({ request, backend: { id: "cli:test", label: "test", async send(_, _c, signal) {
    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 10));
    signal.throwIfAborted();
  } }, turn: { finish: async () => [{ path: "a.md", before: "1", after: "2", tracked: true }], onLateChanges: (files) => { late = files; } } }));
  const reader = (await transport.sendMessages({ ...options, abortSignal: controller.signal })).getReader();
  for (;;) { const item = await reader.read(); if (item.done) break; }
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(late).toEqual([{ path: "a.md", before: "1", after: "2", tracked: true }]);
});

it("interleaves text runs with steps and the plan, and keeps that order through storage", async () => {
  const transport = new AgentTransport(async () => ({ request, backend: { id: "test", label: "test", async send(_, c) {
    c.onText("我先找歌单。");
    c.onActivity?.({ id: "a", label: "rg 歌单", status: "running", kind: "command" });
    c.onPlan?.({ steps: [{ step: "找歌单", status: "completed" }, { step: "添加", status: "inProgress" }] });
    c.onActivity?.({ id: "a", label: "rg 歌单", status: "completed", kind: "command" });
    c.onText("找到了"); c.onTextEnd?.(); c.onText("已添加。");
  } } }));
  const reader = (await transport.sendMessages(options)).getReader(); const chunks = [];
  for (;;) { const item = await reader.read(); if (item.done) break; chunks.push(item.value); }
  const order = chunks.flatMap((c) => c.type === "text-start" ? [`text:${c.id}`] : c.type === "data-activity" || c.type === "data-plan" ? [`${c.type}:${c.id}`] : []);
  expect(order).toEqual(["text:response-1", "data-activity:a", "data-plan:plan", "data-activity:a", "text:response-2", "text:response-3"]);
  expect(chunks.find((c) => c.type === "message-metadata")).toMatchObject({ messageMetadata: { finishedAt: expect.any(Number) } });

  const message = { id: "m", role: "assistant" as const, metadata: { createdAt: 1, finishedAt: 5 }, parts: [
    { type: "text" as const, text: "我先找歌单。" },
    { type: "data-activity" as const, id: "a", data: { id: "a", label: "rg 歌单", status: "completed" as const, kind: "command" as const } },
    { type: "data-plan" as const, id: "plan", data: { steps: [{ step: "找歌单", status: "completed" as const }] } },
    { type: "text" as const, text: "已添加。" }] };
  const stored = toStoredMessage(message);
  expect(stored.content).toBe("我先找歌单。\n\n已添加。");
  expect(stored.timeline).toEqual([{ text: 6 }, { activity: "a" }, { plan: true }, { text: 4 }]);
  expect(fromStoredMessage(stored).parts.slice(0, 4)).toEqual(message.parts);
  expect(fromStoredMessage(stored).metadata?.finishedAt).toBe(5);
});
it("shows old replies as steps then text, and falls back when the timeline no longer fits", () => {
  const activity = { id: "a", label: "读取", status: "completed" as const };
  const legacy = fromStoredMessage({ id: "m", role: "assistant", content: "答案", createdAt: 1, activities: [activity] });
  expect(legacy.parts.slice(0, 2).map((p) => p.type)).toEqual(["data-activity", "text"]);
  const edited = fromStoredMessage({ id: "m", role: "assistant", content: "改过的答案", createdAt: 1, activities: [activity], timeline: [{ text: 2 }, { activity: "a" }] });
  expect(edited.parts.slice(0, 2)).toMatchObject([{ type: "data-activity" }, { type: "text", text: "改过的答案" }]);
});
it("streams a question card, returns the answers to the agent and keeps the Q&A in its place when saved", async () => {
  const question = { id: "question-1", questions: [{ id: "style", header: "风格", question: "用哪种风格？", options: [{ label: "轻松" }, { label: "理性" }] },
    { id: "token", question: "访问令牌？", options: [], secret: true }] };
  const transport = new AgentTransport(async () => ({ request, backend: { id: "cli:test", label: "test", async send(_, c) {
    c.onText("先确认一下。");
    const answers = await c.requestUserInput?.(question);
    c.onText(`已选：${answers?.style?.join("")}`);
  } }, turn: { awaitAnswers: async () => ({ style: ["轻松"], token: ["sk-secret"] }) } }));
  const reader = (await transport.sendMessages(options)).getReader(); const chunks = [];
  for (;;) { const item = await reader.read(); if (item.done) break; chunks.push(item.value); }
  const cards = chunks.filter((c) => c.type === "data-question") as Array<{ data: { status: string } }>;
  expect(cards.map((c) => c.data.status)).toEqual(["pending", "answered"]);
  expect(chunks.filter((c) => c.type === "text-delta").map((c) => (c as { delta: string }).delta).join("")).toContain("已选：轻松");
  // The text before the question is its own run, so the card sits between the two paragraphs.
  expect(chunks.filter((c) => c.type === "text-start")).toHaveLength(2);

  const stored = toStoredMessage({ id: "m", role: "assistant", metadata: { createdAt: 1 }, parts: [{ type: "text", text: "先确认一下。" },
    { type: "data-question", id: "question-1", data: { ...question, status: "answered", answers: { style: ["轻松"], token: ["sk-secret"] } } },
    { type: "text", text: "已选：轻松" }] });
  expect(stored.timeline).toEqual([{ text: 6 }, { question: "question-1" }, { text: 5 }]);
  expect(JSON.stringify(stored)).not.toContain("sk-secret");
  expect(fromStoredMessage(stored).parts.map((p) => p.type)).toEqual(["text", "data-question", "text"]);

  const open = toStoredMessage({ id: "n", role: "assistant", metadata: { createdAt: 1 }, parts: [{ type: "data-question", id: "q", data: { ...question, id: "q", status: "pending" } }] });
  expect(open.questions?.[0]?.status).toBe("cancelled");
});
