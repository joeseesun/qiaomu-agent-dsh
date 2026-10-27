// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QuestionCard } from "../src/ui/question-card";
import type { QuestionState } from "../src/types";

afterEach(() => { cleanup(); vi.useRealTimers(); });

const pending: QuestionState = { id: "q", status: "pending", questions: [
  { id: "store", header: "存储", question: "会话存在哪里？", allowOther: true, options: [{ label: "Postgres", description: "和应用放一起" }, { label: "Redis" }] },
  { id: "platforms", header: "平台", question: "支持哪些平台？", multiSelect: true, options: [{ label: "macOS" }, { label: "iOS" }] },
] };

describe("question card", () => {
  it("walks through the questions, advancing after a single choice, and submits every answer", () => {
    vi.useFakeTimers();
    const onAnswer = vi.fn();
    render(<QuestionCard state={pending} onAnswer={onAnswer} />);
    expect(screen.getByRole("img", { name: "已回答 0/2" })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /Redis/ }));
    expect(screen.getByRole("radio", { name: /Redis/ }).getAttribute("aria-checked")).toBe("true");
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.getByText("支持哪些平台？")).toBeTruthy();
    expect(screen.getByRole("img", { name: "已回答 1/2" })).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "macOS" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "iOS" }));
    fireEvent.click(screen.getByRole("button", { name: /提交/ }));
    expect(onAnswer).toHaveBeenCalledWith({ store: ["Redis"], platforms: ["macOS", "iOS"] });
  });

  it("takes a typed answer instead of an option, and letter keys pick options", () => {
    const onAnswer = vi.fn();
    render(<QuestionCard state={{ ...pending, questions: [pending.questions[0]!] }} onAnswer={onAnswer} />);
    const card = screen.getByRole("group", { name: "需要你回答" });
    fireEvent.keyDown(card, { key: "a" });
    expect(screen.getByRole("radio", { name: /Postgres/ }).getAttribute("aria-checked")).toBe("true");
    const other = screen.getByRole("textbox", { name: "其他答案" });
    fireEvent.focus(other);
    fireEvent.change(other, { target: { value: "自建 KV" } });
    expect(screen.getByRole("radio", { name: /Postgres/ }).getAttribute("aria-checked")).toBe("false");
    fireEvent.keyDown(other, { key: "Enter" });
    expect(onAnswer).toHaveBeenCalledWith({ store: ["自建 KV"] });
  });

  it("skips questions, and cannot submit an entirely empty card except by skipping", () => {
    const onAnswer = vi.fn();
    render(<QuestionCard state={pending} onAnswer={onAnswer} />);
    fireEvent.click(screen.getByRole("button", { name: "跳过" }));
    expect((screen.getByRole("button", { name: /提交/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("tab", { name: "存储" }));
    fireEvent.click(screen.getByRole("radio", { name: /Postgres/ }));
    fireEvent.click(screen.getByRole("tab", { name: /平台/ }));
    fireEvent.click(screen.getByRole("button", { name: "跳过" }));
    expect(onAnswer).toHaveBeenCalledWith({ store: ["Postgres"] });
    expect(onAnswer).toHaveBeenCalledTimes(1);
  });

  it("shows a settled card as a quiet summary, masking secrets", () => {
    render(<QuestionCard onAnswer={vi.fn()} state={{ id: "q", status: "answered", answers: { store: ["Redis"], key: ["••••••"] }, questions: [
      pending.questions[0]!, pending.questions[1]!, { id: "key", question: "密钥？", options: [], secret: true }] }} />);
    expect(screen.getByText("Redis")).toBeTruthy();
    expect(screen.getByText("跳过")).toBeTruthy();
    expect(screen.getByText("已填写")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
