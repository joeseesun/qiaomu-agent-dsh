import type { QuestionAnswers, QuestionRequest, QuestionState, UserQuestion } from "../types";

/**
 * Questions an agent asks mid-turn, translated from each protocol into one card:
 * Codex App Server `item/tool/requestUserInput`, ACP form elicitation (Claude Code's
 * AskUserQuestion arrives this way), and the `ask_user` tool given to API models.
 */

type Json = Record<string, unknown>;
const record = (value: unknown): Json | null => value && typeof value === "object" && !Array.isArray(value) ? value as Json : null;
const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";

function options(value: unknown): UserQuestion["options"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const option = record(item);
    const label = text(option?.label);
    const description = text(option?.description);
    return label ? [{ label, ...(description ? { description } : {}) }] : [];
  });
}

// ---- Codex App Server ----------------------------------------------------------------------

export function codexQuestionRequest(params: unknown, id: string): QuestionRequest | null {
  const questions = (Array.isArray(record(params)?.questions) ? record(params)!.questions as unknown[] : []).flatMap((item, index): UserQuestion[] => {
    const question = record(item);
    const body = text(question?.question);
    if (!question || !body) return [];
    const choices = options(question.options);
    return [{
      id: text(question.id) || `q${index}`,
      question: body,
      options: choices,
      ...(text(question.header) ? { header: text(question.header) } : {}),
      ...(question.isOther === true && choices.length ? { allowOther: true } : {}),
      ...(question.isSecret === true ? { secret: true } : {}),
    }];
  });
  return questions.length ? { id, questions } : null;
}

/** A dismissed card answers nothing; Codex then continues without the answers. */
export function codexQuestionResponse(answers: QuestionAnswers | null): { answers: Record<string, { answers: string[] }> } {
  return { answers: Object.fromEntries(Object.entries(answers ?? {}).map(([id, values]) => [id, { answers: values }])) };
}

// ---- ACP form elicitation --------------------------------------------------------------------

/** claude-agent-acp marks each question's free-text companion field with this `_meta` key. */
const CUSTOM_ANSWER_META = "_askUserQuestionCustomAnswer";

interface ElicitationField {
  key: string;
  kind: "single" | "multi" | "text" | "boolean" | "number";
  /** Shown label → schema value, when they differ. */
  values: Array<{ label: string; value?: string }>;
  /** The free-text companion field. */
  custom?: string;
}
export interface ElicitationQuestions { request: QuestionRequest; fields: ElicitationField[] }

function enumOptions(schema: Json | null): UserQuestion["options"] {
  const list = Array.isArray(schema?.oneOf) ? schema!.oneOf : Array.isArray(schema?.anyOf) ? schema!.anyOf : null;
  if (list) return list.flatMap((item) => {
    const option = record(item);
    const value = typeof option?.const === "string" ? option.const : "";
    const label = text(option?.title) || value;
    return value ? [{ label, ...(text(option?.description) ? { description: text(option?.description) } : {}), ...(label !== value ? { value } : {}) }] : [];
  });
  if (Array.isArray(schema?.enum)) {
    const names = Array.isArray(schema!.enumNames) ? schema!.enumNames as unknown[] : [];
    return (schema!.enum as unknown[]).flatMap((value, index) => typeof value === "string" ? [{ label: text(names[index]) || value, ...(text(names[index]) && text(names[index]) !== value ? { value } : {}) }] : []);
  }
  return [];
}

/** Reads a form elicitation as questions; null when the form cannot be shown as one. */
export function acpElicitationQuestions(params: unknown, id: string): ElicitationQuestions | null {
  const body = record(params);
  if (!body || (body.mode !== undefined && body.mode !== "form")) return null;
  const properties = record(record(body.requestedSchema)?.properties);
  if (!properties) return null;
  const message = text(body.message);
  const entries = Object.entries(properties).map(([key, value]) => [key, record(value)] as const);
  const customFor = new Map<string, string>();
  for (const [key, schema] of entries) {
    const target = text(record(record(schema?._meta)?.[CUSTOM_ANSWER_META])?.questionId);
    if (target) customFor.set(target, key);
  }
  const companions = new Set(customFor.values());
  const fields: ElicitationField[] = [];
  const questions: UserQuestion[] = [];
  const primary = entries.filter(([key]) => !companions.has(key));
  for (const [key, schema] of primary) {
    if (!schema) continue;
    const title = text(schema.title);
    const question = text(schema.description) || (primary.length === 1 && message) || title || key;
    const header = title && title !== question ? title : undefined;
    let kind: ElicitationField["kind"];
    let choices: Array<UserQuestion["options"][number] & { value?: string }>;
    if (schema.type === "array") { kind = "multi"; choices = enumOptions(record(schema.items)); }
    else if (schema.type === "boolean") { kind = "boolean"; choices = [{ label: "是", value: "true" }, { label: "否", value: "false" }]; }
    else if (schema.type === "number" || schema.type === "integer") { kind = "number"; choices = []; }
    else { choices = enumOptions(schema); kind = choices.length ? "single" : "text"; }
    if (kind === "multi" && !choices.length) return null;
    const custom = customFor.get(key);
    fields.push({ key, kind, values: choices.map(({ label, value }) => ({ label, ...(value ? { value } : {}) })), ...(custom ? { custom } : {}) });
    questions.push({
      id: key, question, options: choices.map(({ label, description }) => ({ label, ...(description ? { description } : {}) })),
      ...(header ? { header } : {}),
      ...(kind === "multi" ? { multiSelect: true } : {}),
      ...(custom ? { allowOther: true } : {}),
    });
  }
  return questions.length ? { request: { id, questions }, fields } : null;
}

export function acpElicitationResponse(parsed: ElicitationQuestions, answers: QuestionAnswers | null): { action: "accept"; content: Record<string, string | number | boolean | string[]> } | { action: "cancel" } {
  if (!answers) return { action: "cancel" };
  const content: Record<string, string | number | boolean | string[]> = {};
  for (const field of parsed.fields) {
    const picked = answers[field.key];
    if (!picked?.length) continue;
    const valueOf = (label: string) => field.values.find((choice) => choice.label === label);
    const known = picked.filter((item) => valueOf(item));
    const typed = picked.filter((item) => !valueOf(item)).join("，");
    const values = known.map((label) => valueOf(label)!.value ?? label);
    if (field.kind === "boolean") { if (values[0]) content[field.key] = values[0] === "true"; continue; }
    if (field.kind === "number") { const number = Number(typed); if (typed && Number.isFinite(number)) content[field.key] = number; continue; }
    if (field.kind === "text") { if (typed) content[field.key] = typed; continue; }
    if (field.kind === "multi") { if (values.length) content[field.key] = values; }
    else if (values[0]) content[field.key] = values[0];
    if (typed) {
      if (field.custom) content[field.custom] = typed;
      else if (!values.length) content[field.key] = typed;
    }
  }
  return { action: "accept", content };
}

// ---- API models ------------------------------------------------------------------------------

export interface AskUserInput {
  questions: Array<{ header?: string; question: string; options?: Array<{ label: string; description?: string }>; multiSelect?: boolean }>;
}

export const ASK_USER_SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array", minItems: 1, maxItems: 4,
      items: {
        type: "object",
        properties: {
          header: { type: "string", description: "2–6 字的主题标签，例如「文章风格」" },
          question: { type: "string", description: "完整的问题，以问号结尾" },
          options: {
            type: "array", minItems: 2, maxItems: 4,
            items: { type: "object", properties: { label: { type: "string", description: "1–8 字的选项" }, description: { type: "string", description: "选这个意味着什么、有什么取舍" } }, required: ["label"], additionalProperties: false },
          },
          multiSelect: { type: "boolean", description: "可以多选时为 true" },
        },
        required: ["question", "options"], additionalProperties: false,
      },
    },
  },
  required: ["questions"], additionalProperties: false,
} as const;

export const ASK_USER_DESCRIPTION = "向用户提出 1–4 个带选项的问题，并等待回答。只在确实需要用户做决定、且无法从上下文或常识判断时使用，例如风格、范围或有取舍的方案。每题给 2–4 个互斥选项，推荐项放第一个并在 label 末尾加「（推荐）」；用户总能另外输入自己的答案。不要用它确认显而易见的事，也不要问「要不要继续」。";

export function askUserRequest(input: AskUserInput, id: string): QuestionRequest | null {
  const questions = (Array.isArray(input?.questions) ? input.questions : []).slice(0, 4).flatMap((item, index): UserQuestion[] => {
    const question = text(item?.question);
    if (!question) return [];
    return [{
      id: `q${index + 1}`, question, options: options(item.options).slice(0, 6), allowOther: true,
      ...(text(item.header) ? { header: text(item.header) } : {}),
      ...(item.multiSelect === true ? { multiSelect: true } : {}),
    }];
  });
  return questions.length ? { id, questions } : null;
}

export function askUserResult(request: QuestionRequest, answers: QuestionAnswers | null): Record<string, unknown> {
  if (!answers) return { status: "dismissed", note: "用户关闭了问题，没有回答。不要重复提问；按最稳妥的默认做法继续，并说明你的假设。" };
  return {
    status: "answered",
    answers: request.questions.map((question) => ({ question: question.question, answer: answers[question.id]?.length ? answers[question.id]!.join("，") : "（跳过）" })),
  };
}

// ---- Storage -----------------------------------------------------------------------------------

/** Secret answers never reach saved conversations. */
export function storableQuestion(state: QuestionState): QuestionState {
  if (!state.answers || !state.questions.some((question) => question.secret)) return state;
  const answers = { ...state.answers };
  for (const question of state.questions) if (question.secret && answers[question.id]) answers[question.id] = ["••••••"];
  return { ...state, answers };
}
