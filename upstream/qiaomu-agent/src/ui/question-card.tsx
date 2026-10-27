import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Check, CircleCheck, CircleSlash, MessageCircleQuestion } from "lucide-react";
import { Platform } from "obsidian";
import type { QuestionAnswers, QuestionState, UserQuestion } from "../types";

/**
 * Questions the agent needs answered before it continues (Claude Code AskUserQuestion,
 * Codex request_user_input, the API `ask_user` tool). One question at a time, lettered
 * options, a typed answer when allowed, skip, and a progress ring for several questions.
 * Layout follows Kobra's Question Card. shadcn Questionnaire now exists but requires
 * React 19; retain this React 18 host adapter (see the October 2026 research note).
 */

interface Draft { picked: string[]; other: string; otherOn: boolean }
const EMPTY: Draft = { picked: [], other: "", otherOn: false };
const KEYS = "ABCDEFGHIJ";

function draftAnswer(question: UserQuestion, draft: Draft | undefined): string[] {
  if (!draft) return [];
  const typed = draft.otherOn || !question.options.length ? draft.other.trim() : "";
  return [...draft.picked, ...(typed ? [typed] : [])];
}

export function QuestionCard({ state, onAnswer }: { state: QuestionState; onAnswer: (answers: QuestionAnswers | null) => void }) {
  if (state.status !== "pending") return <QuestionSummary state={state} />;
  return <PendingQuestions state={state} onAnswer={onAnswer} />;
}

function PendingQuestions({ state, onAnswer }: { state: QuestionState; onAnswer: (answers: QuestionAnswers | null) => void }) {
  const baseId = useId();
  const { questions } = state;
  const [index, setIndex] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [visited, setVisited] = useState<Set<string>>(new Set());
  const [sent, setSent] = useState(false);
  const cardRef = useRef<HTMLElement>(null);
  const otherRef = useRef<HTMLInputElement>(null);
  const moved = useRef(false);
  const advance = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(advance.current), []);
  const question = questions[index]!;
  const draft = drafts[question.id] ?? EMPTY;
  const last = index === questions.length - 1;
  const answered = questions.filter((item) => draftAnswer(item, drafts[item.id]).length > 0).length;
  const hasAnswer = draftAnswer(question, draft).length > 0;
  const typedOnly = !question.options.length;
  const canNext = !sent && !(last && !hasAnswer && answered === 0);
  const otherIndex = question.options.length;

  // Keyboard users keep their place: moving to the next question focuses its first choice.
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    const target = cardRef.current?.querySelector<HTMLElement>(".qa-question-option, .qa-question-other input");
    target?.focus();
  }, [index]);

  const update = (next: Partial<Draft>) => setDrafts((all) => ({ ...all, [question.id]: { ...(all[question.id] ?? EMPTY), ...next } }));
  const submit = (final: Record<string, Draft>) => {
    if (sent) return;
    setSent(true);
    const answers: QuestionAnswers = {};
    for (const item of questions) {
      const values = draftAnswer(item, final[item.id]);
      if (values.length) answers[item.id] = values;
    }
    onAnswer(answers);
  };
  const go = (to: number, focus: boolean) => {
    window.clearTimeout(advance.current);
    setVisited((all) => new Set(all).add(question.id));
    moved.current = focus;
    setIndex(to);
  };
  const next = (focus = true) => {
    if (last) submit(drafts);
    else go(index + 1, focus);
  };
  const skip = () => {
    const cleared = { ...drafts, [question.id]: EMPTY };
    setDrafts(cleared);
    if (last) submit(cleared);
    else go(index + 1, true);
  };
  const choose = (label: string, viaKeyboard: boolean) => {
    if (question.multiSelect) {
      update({ picked: draft.picked.includes(label) ? draft.picked.filter((item) => item !== label) : [...draft.picked, label] });
      return;
    }
    update({ picked: [label], otherOn: false });
    // A single choice settles the question; move on unless it is the last one, which waits for 提交.
    window.clearTimeout(advance.current);
    if (!last) advance.current = window.setTimeout(() => go(index + 1, viaKeyboard), 160);
  };
  const toggleOther = () => {
    update(question.multiSelect ? { otherOn: !draft.otherOn } : { otherOn: true, picked: [] });
    otherRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.nativeEvent.isComposing) return;
    const inInput = event.target instanceof HTMLInputElement;
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey || inInput)) {
      event.preventDefault();
      if (canNext && (hasAnswer || !inInput)) next();
      return;
    }
    if (inInput) {
      if (event.key === "Escape") { event.preventDefault(); (event.target as HTMLInputElement).blur(); }
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const key = event.key.toUpperCase();
    const position = key.length === 1 ? (KEYS.indexOf(key) >= 0 ? KEYS.indexOf(key) : /[1-9]/.test(key) ? Number(key) - 1 : -1) : -1;
    if (position >= 0 && position < question.options.length) { event.preventDefault(); choose(question.options[position]!.label, true); return; }
    if (position === otherIndex && (question.allowOther || typedOnly)) { event.preventDefault(); toggleOther(); return; }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const items = [...(cardRef.current?.querySelectorAll<HTMLElement>(".qa-question-option, .qa-question-other input") ?? [])];
      const at = items.indexOf(document.activeElement as HTMLElement);
      if (at < 0) return;
      event.preventDefault();
      items[(at + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
    }
  };

  const titleId = `${baseId}-title`;
  const textId = `${baseId}-q${index}`;
  const shortcut = Platform.isMacOS ? "⌘" : "Ctrl";
  return <section ref={cardRef} className="qa-question is-pending" role="group" aria-labelledby={titleId} onKeyDown={onKeyDown}>
    <header className="qa-question-head">
      <MessageCircleQuestion size={15} aria-hidden="true" />
      <span id={titleId}>{questions.length > 1 ? "需要你回答几个问题" : "需要你回答"}</span>
      {questions.length > 1 && <ProgressRing done={answered} total={questions.length} />}
    </header>
    {questions.length > 1 && <div className="qa-question-tabs" role="tablist" aria-label="问题">
      {questions.map((item, position) => {
        const filled = draftAnswer(item, drafts[item.id]).length > 0;
        return <button key={item.id} type="button" role="tab" aria-selected={position === index} tabIndex={position === index ? 0 : -1}
          className={`qa-question-tab${position === index ? " is-current" : ""}${filled ? " is-filled" : visited.has(item.id) ? " is-skipped" : ""}`}
          onClick={() => go(position, false)}>
          {filled && <Check size={12} aria-hidden="true" />}
          <span>{item.header || `问题 ${position + 1}`}</span>
        </button>;
      })}
    </div>}
    <div className="qa-question-body" key={question.id}>
      {questions.length === 1 && question.header && <p className="qa-question-header">{question.header}</p>}
      <p className="qa-question-text" id={textId}>{question.question}</p>
      {question.multiSelect && <p className="qa-question-hint">可多选</p>}
      <div className="qa-question-options" role={question.multiSelect ? "group" : "radiogroup"} aria-labelledby={textId}>
        {question.options.map((option, position) => {
          const selected = draft.picked.includes(option.label);
          return <button key={option.label} type="button" role={question.multiSelect ? "checkbox" : "radio"} aria-checked={selected}
            className={`qa-question-option${selected ? " is-selected" : ""}`} onClick={(event) => choose(option.label, event.detail === 0)}>
            <span className="qa-question-key" aria-hidden="true">{selected && question.multiSelect ? <Check size={11} strokeWidth={3} /> : KEYS[position] ?? ""}</span>
            <span className="qa-question-choice">
              <span className="qa-question-label">{option.label}</span>
              {option.description && <span className="qa-question-desc">{option.description}</span>}
            </span>
          </button>;
        })}
        {(question.allowOther || typedOnly) && <label className={`qa-question-option qa-question-other${draft.otherOn || (typedOnly && draft.other) ? " is-selected" : ""}`}>
          {!typedOnly && <span className="qa-question-key" aria-hidden="true">{KEYS[otherIndex] ?? ""}</span>}
          <input ref={otherRef} type={question.secret ? "password" : "text"} autoComplete="off" spellCheck={!question.secret}
            aria-label={typedOnly ? "你的回答" : "其他答案"} placeholder={typedOnly ? "输入你的回答…" : "其他…"}
            value={draft.other}
            onFocus={() => { if (!typedOnly && !draft.otherOn) update(question.multiSelect ? { otherOn: true } : { otherOn: true, picked: [] }); }}
            onChange={(event) => update({ other: event.currentTarget.value, otherOn: true, ...(question.multiSelect ? {} : { picked: [] }) })} />
        </label>}
      </div>
    </div>
    <footer className="qa-question-actions">
      <button type="button" className="qa-question-skip" disabled={sent} onClick={skip}>跳过</button>
      <button type="button" className="mod-cta" disabled={!canNext} onClick={() => next(false)}>
        {last ? "提交" : "下一题"}
        <span className="qa-question-shortcut" aria-hidden="true"><kbd>{shortcut}</kbd><kbd>↵</kbd></span>
      </button>
    </footer>
  </section>;
}

function ProgressRing({ done, total }: { done: number; total: number }) {
  const radius = 7;
  const length = 2 * Math.PI * radius;
  return <span className="qa-question-progress" role="img" aria-label={`已回答 ${done}/${total}`}>
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <circle cx="9" cy="9" r={radius} className="qa-question-ring-track" />
      <circle cx="9" cy="9" r={radius} className="qa-question-ring-fill" strokeDasharray={length} strokeDashoffset={length * (1 - done / total)} />
    </svg>
    <span className="qa-question-count">{done}/{total}</span>
  </span>;
}

function QuestionSummary({ state }: { state: QuestionState }) {
  const cancelled = state.status === "cancelled";
  return <section className={`qa-question is-settled${cancelled ? " is-cancelled" : ""}`} aria-label={cancelled ? "问题未回答" : "已回答的问题"}>
    <header className="qa-question-head">
      {cancelled ? <CircleSlash size={14} aria-hidden="true" /> : <CircleCheck size={14} aria-hidden="true" />}
      <span>{cancelled ? "问题未回答" : "已回答"}</span>
    </header>
    <dl className="qa-question-summary">
      {state.questions.map((question) => {
        const answer = state.answers?.[question.id];
        return <div key={question.id}>
          <dt>{question.header || question.question}</dt>
          <dd className={answer?.length ? undefined : "is-empty"}>{answer?.length ? question.secret ? "已填写" : answer.join("，") : cancelled ? "—" : "跳过"}</dd>
        </div>;
      })}
    </dl>
  </section>;
}
