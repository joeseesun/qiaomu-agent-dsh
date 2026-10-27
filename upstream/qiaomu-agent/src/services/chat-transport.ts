import type { ChatTransport, UIMessage, UIMessageChunk } from "ai";
import type { ApprovalRequest, ApprovalState, ChatActivity, ChatAttachment, ChatBackend, ChatCallbacks, ChatMessage, ChatPlan, ChatRequest, ContextUsage, FileChange, GeneratedAttachment, QuestionAnswers, QuestionRequest, QuestionState, TimelineEntry, TurnChanges } from "../types";
import { storableQuestion } from "./user-questions";

export type AgentMessage = UIMessage<
  { createdAt: number; finishedAt?: number; backend?: string; sourcePath?: string; attachments?: import("../types").ChatAttachment[]; prompt?: import("../types").SentPrompt },
  { activity: ChatActivity; plan: ChatPlan; status: string; attachment: ChatAttachment; changes: TurnChanges; approval: ApprovalState; question: QuestionState; usage: ContextUsage }
>;

/** Per-turn host services: change tracking, file access and approvals. */
export interface TurnHooks {
  onFileIntent?: ChatCallbacks["onFileIntent"];
  host?: ChatCallbacks["host"];
  awaitApproval?: (request: ApprovalRequest, signal: AbortSignal) => Promise<string | null>;
  awaitAnswers?: (request: QuestionRequest, signal: AbortSignal) => Promise<QuestionAnswers | null>;
  /** Collects what the turn changed; called once, also after errors and aborts. */
  finish?: () => Promise<FileChange[]>;
  /** Receives changes the stream could no longer carry (the turn was stopped). */
  onLateChanges?: (changes: FileChange[]) => void;
}

/** Stored conversations keep file contents only up to this total; larger turns stay listed but not restorable. */
export const MAX_STORED_CHANGE_BYTES = 1_500_000;

export function storableChanges(changes: TurnChanges): TurnChanges {
  let budget = MAX_STORED_CHANGE_BYTES;
  return {
    ...changes,
    files: changes.files.map((file) => {
      const size = (file.before?.length ?? 0) + (file.after?.length ?? 0);
      if (size <= budget) { budget -= size; return file; }
      return { path: file.path, before: null, after: null, tracked: false, outside: file.outside, binary: true };
    }),
  };
}
/** Context usage reported for this reply; reports share one id, so the part is updated in place. */
export function messageUsage(message: AgentMessage): ContextUsage | undefined {
  const part = message.parts.find((p) => p.type === "data-usage");
  return part?.type === "data-usage" ? part.data : undefined;
}

/** A reply's text runs in order; steps between them split the text into paragraphs. */
export const textRuns = (message: AgentMessage): string[] => message.parts
  .flatMap((part) => part.type === "text" && part.text.trim() ? [part.text] : []);

export const messageText = (message: AgentMessage): string => textRuns(message).join(TEXT_RUN_SEPARATOR);

const TEXT_RUN_SEPARATOR = "\n\n";

function messageTimeline(message: AgentMessage): TimelineEntry[] | undefined {
  if (!message.parts.some((part) => part.type === "data-activity" || part.type === "data-plan" || part.type === "data-question")) return undefined;
  return message.parts.flatMap((part): TimelineEntry[] => part.type === "text" ? (part.text.trim() ? [{ text: part.text.length }] : [])
    : part.type === "data-activity" ? [{ activity: part.data.id }] : part.type === "data-plan" ? [{ plan: true }]
      : part.type === "data-question" ? [{ question: part.data.id }] : []);
}

/** Rebuilds the ordered parts of a stored reply; falls back to steps-then-text when the timeline no longer fits the text. */
function timelineParts(message: ChatMessage): AgentMessage["parts"] {
  const activities = new Map((message.activities ?? []).map((data) => [data.id, data]));
  const questions = new Map((message.questions ?? []).map((data) => [data.id, data]));
  const legacy: AgentMessage["parts"] = [
    ...(message.plan ? [{ type: "data-plan" as const, id: "plan", data: message.plan }] : []),
    ...[...activities.values()].map((data) => ({ type: "data-activity" as const, id: data.id, data })),
    { type: "text", text: message.content }];
  const timeline = message.timeline;
  if (!timeline) return message.activities?.length || message.plan ? legacy : [{ type: "text", text: message.content }];
  const runs = timeline.flatMap((entry) => "text" in entry ? [entry.text] : []);
  if (runs.reduce((sum, length) => sum + length, 0) + Math.max(0, runs.length - 1) * TEXT_RUN_SEPARATOR.length !== message.content.length) return legacy;
  let offset = 0;
  return timeline.flatMap((entry): AgentMessage["parts"] => {
    if ("text" in entry) {
      const text = message.content.slice(offset, offset + entry.text);
      offset += entry.text + TEXT_RUN_SEPARATOR.length;
      return [{ type: "text", text }];
    }
    if ("plan" in entry) return message.plan ? [{ type: "data-plan", id: "plan", data: message.plan }] : [];
    if ("question" in entry) { const data = questions.get(entry.question); return data ? [{ type: "data-question", id: data.id, data }] : []; }
    const data = activities.get(entry.activity);
    return data ? [{ type: "data-activity", id: data.id, data }] : [];
  });
}

export function toStoredMessage(message: AgentMessage): ChatMessage {
  const attachments = new Map<string, ChatAttachment>();
  for (const attachment of message.metadata?.attachments ?? []) attachments.set(attachment.id, attachment);
  for (const part of message.parts) if (part.type === "data-attachment") attachments.set(part.data.id, part.data);
  return {
    id: message.id, role: message.role === "system" ? "status" : message.role,
    content: messageText(message), createdAt: message.metadata?.createdAt ?? Date.now(),
    backend: message.metadata?.backend, sourcePath: message.metadata?.sourcePath,
    attachments: [...attachments.values()].map((attachment) => attachment.vaultPath ? { ...attachment, url: undefined } : attachment),
    activities: message.parts.filter((p) => p.type === "data-activity").map((p) => p.data),
    timeline: messageTimeline(message),
    questions: (() => {
      // A question still open when the reply was saved can no longer be answered.
      const asked = message.parts.flatMap((p) => p.type === "data-question" ? [storableQuestion(p.data.status === "pending" ? { ...p.data, status: "cancelled" } : p.data)] : []);
      return asked.length ? asked : undefined;
    })(),
    plan: (() => { const part = message.parts.find((p) => p.type === "data-plan"); return part?.type === "data-plan" ? part.data : undefined; })(),
    finishedAt: message.metadata?.finishedAt,
    prompt: message.metadata?.prompt,
    changes: (() => { const part = message.parts.find((p) => p.type === "data-changes"); return part && part.type === "data-changes" ? storableChanges(part.data) : undefined; })(),
    usage: messageUsage(message),
  };
}
export function fromStoredMessage(message: ChatMessage, resolveAttachment: (attachment: ChatAttachment) => ChatAttachment = (value) => value): AgentMessage {
  const attachments = (message.attachments ?? []).map(resolveAttachment);
  return {
    id: message.id, role: message.role === "status" ? "system" : message.role,
    metadata: { createdAt: message.createdAt, finishedAt: message.finishedAt, ...(message.prompt ? { prompt: message.prompt } : {}), backend: message.backend, sourcePath: message.sourcePath, attachments },
    parts: [ ...timelineParts(message),
      ...(message.changes?.files.length ? [{ type: "data-changes" as const, id: "changes", data: message.changes }] : []),
      ...(message.usage ? [{ type: "data-usage" as const, id: "usage", data: message.usage }] : []),
      ...(message.role === "assistant" ? attachments.flatMap((data) => [
        { type: "file" as const, url: data.url ?? "", mediaType: data.mediaType, filename: data.name },
        { type: "data-attachment" as const, id: data.id, data },
      ]) : []) ],
  };
}

type PreparedRequest = { backend: ChatBackend; request: ChatRequest; turn?: TurnHooks };
/** Converts native callbacks to SDK chunks without an HTTP server or protocol replacement. */
export class AgentTransport implements ChatTransport<AgentMessage> {
  constructor(
    private readonly prepare: (messages: AgentMessage[], signal: AbortSignal) => Promise<PreparedRequest>,
    private readonly storeAttachment?: (attachment: GeneratedAttachment) => Promise<ChatAttachment>,
  ) {}
  async sendMessages(options: Parameters<ChatTransport<AgentMessage>["sendMessages"]>[0]): Promise<ReadableStream<UIMessageChunk>> {
    const controller = new AbortController();
    let abortStream: (() => void) | undefined;
    const abort = () => { controller.abort(); abortStream?.(); };
    options.abortSignal?.addEventListener("abort", abort, { once: true });
    if (options.abortSignal?.aborted) abort();
    let closed = false;
    const cleanup = () => options.abortSignal?.removeEventListener("abort", abort);
    return new ReadableStream<UIMessageChunk>({
      start: (stream) => {
        const emit = (chunk: UIMessageChunk) => { if (!closed) stream.enqueue(chunk); };
        abortStream = () => {
          if (closed) return;
          emit({ type: "abort" }); closed = true; stream.close(); cleanup();
        };
        let turn: TurnHooks | undefined;
        void (async () => {
          try {
            controller.signal.throwIfAborted();
            const prepared = await this.prepare(options.messages, controller.signal);
            const { backend, request } = prepared;
            turn = prepared.turn;
            controller.signal.throwIfAborted();
            emit({ type: "start", messageMetadata: { createdAt: Date.now(), backend: backend.label, sourcePath: request.activeFilePath } });
            const activities = new Map<string, ChatActivity>();
            const hooks = turn;
            // Text opens a run on demand; a new step, plan, file or question ends it, so the reply keeps its order.
            let run: string | null = null; let runs = 0;
            const endRun = () => { if (run) { emit({ type: "text-end", id: run }); run = null; } };
            await backend.send(request, {
              onText: (delta) => {
                if (!run) { run = `response-${++runs}`; emit({ type: "text-start", id: run }); }
                emit({ type: "text-delta", id: run, delta });
              },
              onTextEnd: endRun,
              onStatus: (data) => emit({ type: "data-status", data, transient: true }),
              onPlan: (data) => { endRun(); emit({ type: "data-plan", id: "plan", data }); },
              onActivity: (next) => {
                const previous = activities.get(next.id);
                if (!previous) endRun();
                const data = { ...previous, ...next, label: next.label === "工具调用" && previous ? previous.label : next.label, detail: next.detail ?? previous?.detail };
                activities.set(next.id, data);
                emit({ type: "data-activity", id: next.id, data });
              },
              onAttachment: async (incoming) => {
                const attachment = this.storeAttachment ? await this.storeAttachment(incoming) : {
                  id: incoming.id, name: incoming.name, mediaType: incoming.mediaType, size: incoming.size,
                  url: incoming.base64 ? `data:${incoming.mediaType};base64,${incoming.base64}` : incoming.localPath,
                };
                if (!attachment.url) throw new Error(`无法展示生成文件 ${attachment.name}`);
                endRun();
                emit({ type: "file", url: attachment.url, mediaType: attachment.mediaType });
                emit({ type: "data-attachment", id: attachment.id, data: attachment });
              },
              onUsage: (data) => emit({ type: "data-usage", id: "usage", data }),
              onFileIntent: hooks?.onFileIntent,
              host: hooks?.host,
              requestApproval: hooks?.awaitApproval ? async (approval) => {
                endRun();
                emit({ type: "data-approval", id: approval.id, data: { ...approval, status: "pending" } });
                const chosen = await hooks.awaitApproval!(approval, controller.signal).catch(() => null);
                emit({ type: "data-approval", id: approval.id, data: { ...approval, status: chosen ? "decided" : "cancelled", ...(chosen ? { chosen } : {}) } });
                return chosen;
              } : undefined,
              requestUserInput: hooks?.awaitAnswers ? async (question) => {
                endRun();
                emit({ type: "data-question", id: question.id, data: { ...question, status: "pending" } });
                const answers = await hooks.awaitAnswers!(question, controller.signal).catch(() => null);
                emit({ type: "data-question", id: question.id, data: { ...question, status: answers ? "answered" : "cancelled", ...(answers ? { answers } : {}) } });
                return answers;
              } : undefined,
            }, controller.signal);
            controller.signal.throwIfAborted();
            const finish = turn?.finish; turn = undefined;
            const files = finish ? await finish() : [];
            if (files.length) emit({ type: "data-changes", id: "changes", data: { files } });
            endRun();
            emit({ type: "message-metadata", messageMetadata: { finishedAt: Date.now() } });
            emit({ type: "finish", finishReason: "stop" });
          } catch (error) {
            emit(controller.signal.aborted ? { type: "abort" } : { type: "error", errorText: error instanceof Error ? error.message : String(error) });
          } finally {
            // Stopped or failed turns may still have written files; report them outside the closed stream.
            const finish = turn?.finish; const late = turn?.onLateChanges; turn = undefined;
            if (finish) {
              const files = await finish().catch(() => [] as FileChange[]);
              if (files.length) { if (!closed) emit({ type: "data-changes", id: "changes", data: { files } }); else late?.(files); }
            }
            cleanup();
            if (!closed) { closed = true; stream.close(); }
          }
        })();
      },
      cancel: () => { closed = true; controller.abort(); cleanup(); },
    });
  }
  async reconnectToStream(): Promise<null> { return null; }
}
