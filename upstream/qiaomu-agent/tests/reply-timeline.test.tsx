// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ReplyTimeline } from "../src/ui/reply-timeline";
import type { AgentMessage } from "../src/services/chat-transport";
afterEach(cleanup);
const text = (value: string) => <span>{value}</span>;
const approval = () => <button>允许一次</button>;
const initial: AgentMessage = { id: "a", role: "assistant", parts: [] };
const props = { renderText: text, renderApproval: approval, renderQuestion: () => <button>回答问题</button>, active: true, statusText: "正在连接…" };
it("replaces the initial indicator with one collapsed live row and preserves manual expansion on updates", () => {
  const { container, rerender } = render(<ReplyTimeline {...props} message={initial} />);
  expect(screen.getByRole("status").textContent).toBe("正在思考…");
  const message: AgentMessage = { ...initial, parts: [{ type: "data-activity", data: { id: "1", kind: "command", label: "obsidian search query=AI", status: "running" } }] };
  rerender(<ReplyTimeline {...props} message={message} />);
  expect(screen.getAllByRole("status")).toHaveLength(1);
  expect(screen.getByRole("status").textContent).toBe("正在搜索资料…");
  const details = container.querySelector(".qa-live-work") as HTMLDetailsElement;
  expect(details.open).toBe(false);
  fireEvent.click(details.querySelector("summary")!);
  expect(details.open).toBe(true);
  message.parts.push({ type: "data-activity", data: { id: "2", kind: "command", label: 'obsidian read path="a.md"', status: "running" } });
  rerender(<ReplyTimeline {...props} message={{ ...message }} />);
  expect(screen.getByRole("status").textContent).toBe("正在阅读内容…");
  expect(details.open).toBe(true);
});
it("keeps pending approvals visible and summarizes failures without a final reply after stopping", () => {
  const message: AgentMessage = { ...initial, parts: [
    { type: "data-activity", data: { id: "1", label: "读取失败", status: "failed" } },
    { type: "data-approval", data: { id: "p", title: "允许写入？", status: "pending", options: [] } },
  ] };
  const { rerender, container } = render(<ReplyTimeline {...props} message={message} />);
  expect(screen.getByRole("button", { name: "允许一次" }).closest("details")).toBeNull();
  expect(screen.getByRole("alert").closest("details")).toBeNull();
  expect(container.querySelector(".qa-working-glyph")).toBeNull();
  rerender(<ReplyTimeline {...props} message={message} active={false} />);
  expect(screen.getByRole("button", { name: "允许一次" }).closest("details")).toBeNull();
  expect(screen.getByRole("alert").closest("details")).toBeNull();
  expect(screen.getByRole("alert").textContent).toBe("有 1 项操作未完成，请展开处理记录查看详情。");
});
it("folds failed attempts into the completed record after recovery and keeps their error details", () => {
  const message: AgentMessage = { ...initial, parts: [
    { type: "data-activity", data: { id: "1", kind: "command", label: "download first-source", status: "failed", detail: "Source unavailable" } },
    { type: "data-activity", data: { id: "2", kind: "command", label: "download fallback", status: "running" } },
  ] };
  const { rerender, container } = render(<ReplyTimeline {...props} message={message} />);
  expect(screen.getByRole("alert").textContent).toContain("download first-source");
  const live = container.querySelector(".qa-live-work") as HTMLDetailsElement;
  fireEvent.click(live.querySelector("summary")!);
  expect(live.open).toBe(true);
  const completed: AgentMessage = { ...message, parts: [message.parts[0]!,
    { type: "data-activity", data: { id: "2", kind: "command", label: "download fallback", status: "completed" } },
    { type: "text", text: "已下载：song.mp3" },
  ] };
  rerender(<ReplyTimeline {...props} message={completed} active={false} />);
  const record = container.querySelector(".qa-worked") as HTMLDetailsElement;
  expect(record.open).toBe(false);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByText("已下载：song.mp3").closest("details")).toBeNull();
  expect(screen.getByText("download first-source").closest(".qa-worked")).toBe(record);
  fireEvent.click(record.querySelector("summary")!);
  const failed = container.querySelector(".qa-step.is-failed") as HTMLDetailsElement;
  fireEvent.click(failed.querySelector("summary")!);
  expect(record.open).toBe(true);
  expect(failed.open).toBe(true);
  expect(screen.getByText("Source unavailable").closest(".qa-worked")).toBe(record);
});
it("keeps the final failure explanation visible without duplicating the failed command", () => {
  const message: AgentMessage = { ...initial, parts: [
    { type: "data-activity", data: { id: "1", label: "download first-source", status: "failed" } },
    { type: "text", text: "下载未完成，请提供可访问的链接后重试。" },
  ] };
  render(<ReplyTimeline {...props} message={message} active={false} />);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByText("下载未完成，请提供可访问的链接后重试。").closest("details")).toBeNull();
  expect(screen.getAllByText("download first-source")).toHaveLength(1);
});
it("keeps unanswered questions visible while working and after stopping", () => {
  const message = { ...initial, parts: [
    { type: "data-activity", data: { id: "1", label: "搜索", status: "completed" } },
    { type: "data-question", data: { id: "q", status: "pending", questions: [] } },
  ] } as AgentMessage;
  const { rerender } = render(<ReplyTimeline {...props} message={message} />);
  expect(screen.getByRole("button", { name: "回答问题" }).closest("details")).toBeNull();
  rerender(<ReplyTimeline {...props} message={message} active={false} />);
  expect(screen.getByRole("button", { name: "回答问题" }).closest("details")).toBeNull();
});
it("preserves an expanded tool output and wrapping when streamed output updates", async () => {
  const step = { id: "stream", kind: "command" as const, label: "read result", status: "running" as const, detail: "first\n" };
  const message: AgentMessage = { ...initial, parts: [{ type: "data-activity", data: step }] };
  const { container, rerender } = render(<ReplyTimeline {...props} message={message} />);
  fireEvent.click(container.querySelector(".qa-live-work > summary")!);
  const disclosure = container.querySelector("details.qa-step") as HTMLDetailsElement;
  fireEvent.click(disclosure.querySelector("summary")!);
  fireEvent.click(screen.getByRole("button", { name: "自动换行" }));
  rerender(<ReplyTimeline {...props} message={{ ...message, parts: [{ type: "data-activity", data: { ...step, detail: "first\nsecond\n" } }] }} />);
  expect(container.querySelector("details.qa-step")).toBe(disclosure);
  expect(disclosure.open).toBe(true);
  expect(disclosure.querySelector("pre")!.textContent).toBe("first\nsecond\n");
  expect(disclosure.querySelector("pre")!.dataset.wrap).toBe("true");
});
