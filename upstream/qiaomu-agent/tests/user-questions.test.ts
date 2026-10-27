import { describe, expect, it } from "vitest";
import { acpElicitationQuestions, acpElicitationResponse, askUserRequest, askUserResult, codexQuestionRequest, codexQuestionResponse } from "../src/services/user-questions";

describe("Codex request_user_input", () => {
  // Captured from codex-cli 0.157.1 with features.default_mode_request_user_input.
  const params = { threadId: "t", turnId: "u", itemId: "call_1", isBlocking: false, autoResolutionMs: null, questions: [
    { id: "article_style", header: "文章风格", question: "你希望这篇文章采用哪种风格？", isOther: true, isSecret: false, options: [
      { label: "轻松叙事（推荐）", description: "像和朋友聊天。" }, { label: "理性分析", description: "观点明确。" }] },
    { id: "api_key", header: "密钥", question: "请提供密钥", isOther: false, isSecret: true, options: null },
  ] };

  it("maps questions, the typed-answer option and secret fields", () => {
    expect(codexQuestionRequest(params, "question-7")).toEqual({ id: "question-7", questions: [
      { id: "article_style", header: "文章风格", question: "你希望这篇文章采用哪种风格？", allowOther: true,
        options: [{ label: "轻松叙事（推荐）", description: "像和朋友聊天。" }, { label: "理性分析", description: "观点明确。" }] },
      { id: "api_key", header: "密钥", question: "请提供密钥", options: [], secret: true },
    ] });
    expect(codexQuestionRequest({ questions: [] }, "x")).toBeNull();
  });

  it("answers by question id, and with nothing when dismissed", () => {
    expect(codexQuestionResponse({ article_style: ["理性分析"] })).toEqual({ answers: { article_style: { answers: ["理性分析"] } } });
    expect(codexQuestionResponse(null)).toEqual({ answers: {} });
  });
});

describe("ACP form elicitation (Claude Code AskUserQuestion)", () => {
  // Shape produced by claude-agent-acp 0.81 askUserQuestionsToCreateRequest.
  const custom = (index: number) => ({ type: "string", title: "Other", _meta: { _askUserQuestionCustomAnswer: { questionId: `question_${index}`, isCustomAnswer: true } } });
  const params = { mode: "form", sessionId: "s", toolCallId: "tool", message: "Please answer the following questions.", requestedSchema: { type: "object", properties: {
    question_0: { type: "string", title: "存储", description: "会话存在哪里？", oneOf: [{ const: "Postgres", title: "Postgres", description: "和应用放一起" }, { const: "Redis", title: "Redis" }] },
    question_0_custom: custom(0),
    question_1: { type: "array", title: "平台", description: "支持哪些平台？", items: { anyOf: [{ const: "macOS", title: "macOS" }, { const: "iOS", title: "iOS" }] } },
    question_1_custom: custom(1),
  } } };

  it("turns select fields into questions and folds the custom fields into 其他", () => {
    const parsed = acpElicitationQuestions(params, "q")!;
    expect(parsed.request.questions).toEqual([
      { id: "question_0", header: "存储", question: "会话存在哪里？", allowOther: true, options: [{ label: "Postgres", description: "和应用放一起" }, { label: "Redis" }] },
      { id: "question_1", header: "平台", question: "支持哪些平台？", allowOther: true, multiSelect: true, options: [{ label: "macOS" }, { label: "iOS" }] },
    ]);
  });

  it("returns picks in the option fields and typed text in the companion field", () => {
    const parsed = acpElicitationQuestions(params, "q")!;
    expect(acpElicitationResponse(parsed, { question_0: ["自建 KV"], question_1: ["macOS", "Android"] })).toEqual({ action: "accept", content: {
      question_0_custom: "自建 KV", question_1: ["macOS"], question_1_custom: "Android",
    } });
    expect(acpElicitationResponse(parsed, {})).toEqual({ action: "accept", content: {} });
    expect(acpElicitationResponse(parsed, null)).toEqual({ action: "cancel" });
  });

  it("uses the message for a lone question and handles plain MCP forms", () => {
    const parsed = acpElicitationQuestions({ mode: "form", message: "继续部署吗？", requestedSchema: { properties: {
      confirm: { type: "boolean", title: "确认" },
    } } }, "q")!;
    expect(parsed.request.questions[0]).toMatchObject({ question: "继续部署吗？", header: "确认", options: [{ label: "是" }, { label: "否" }] });
    expect(acpElicitationResponse(parsed, { confirm: ["否"] })).toEqual({ action: "accept", content: { confirm: false } });
    const typed = acpElicitationQuestions({ message: "名字？", requestedSchema: { properties: { name: { type: "string" } } } }, "q")!;
    expect(typed.request.questions[0]).toMatchObject({ question: "名字？", options: [] });
    expect(acpElicitationResponse(typed, { name: ["乔木"] })).toEqual({ action: "accept", content: { name: "乔木" } });
    expect(acpElicitationQuestions({ mode: "url", url: "https://example.com" }, "q")).toBeNull();
  });
});

describe("ask_user for API models", () => {
  it("normalizes the tool input and reports answers by question text", () => {
    const request = askUserRequest({ questions: [{ header: "长度", question: "写多长？", options: [{ label: "短" }, { label: "长", description: "2000 字以上" }] }, { question: "  " }] }, "question-c1")!;
    expect(request.questions).toEqual([{ id: "q1", header: "长度", question: "写多长？", allowOther: true, options: [{ label: "短" }, { label: "长", description: "2000 字以上" }] }]);
    expect(askUserResult(request, { q1: ["短"] })).toEqual({ status: "answered", answers: [{ question: "写多长？", answer: "短" }] });
    expect(askUserResult(request, {})).toMatchObject({ answers: [{ answer: "（跳过）" }] });
    expect(askUserResult(request, null)).toMatchObject({ status: "dismissed" });
  });
});
