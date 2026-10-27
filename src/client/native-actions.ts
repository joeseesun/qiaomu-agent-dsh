import type { NativeResult } from "./native-models";
import type { NativeNode, Source } from "./native-chat";

export interface PromptSession extends Source<{ sessionId: string; running: boolean; openState: string; promptError?: unknown }> {
  prompt(content: { type: "text"; text: string }[], mode: "queue" | "steer", signal?: AbortSignal): Promise<NativeResult>;
  cancel(): Promise<NativeResult>;
}
export interface ForkService {
  fork(options: { sessionId: string; atSeq?: number; increaseTitle?: boolean }): Promise<string>;
}

/** Explicit user actions bound to one addressed session. Disposing a view does not stop a turn. */
export class NativeSessionActions {
  private disposed = false;
  private submitting = false;
  constructor(readonly sessionId: string, private readonly resolve: () => PromptSession | undefined) {}
  private session() {
    if (this.disposed) throw Error("The Agent view has been closed");
    const session = this.resolve();
    if (!session || session.getSnapshot().sessionId !== this.sessionId) throw Error("The addressed Harness session is unavailable");
    if (session.getSnapshot().openState !== "open") throw Error("Wait for the Harness session to open");
    return session;
  }
  async submit(input: { text: string; attachments?: readonly unknown[]; mode?: "queue" | "steer" }, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    if (!input.text.trim() || input.text.length > 100_000) throw Error("Enter a message of 1–100000 characters");
    if (input.attachments?.length) throw Error("Native attachment submission is not connected yet; attachments were not sent or discarded");
    if (this.submitting) throw Error("This message is still being submitted");
    const session = this.session();
    this.submitting = true;
    try {
      const result = await session.prompt([{ type: "text", text: input.text }], input.mode ?? "queue", signal);
      if (!result.ok) throw Error(`${result.error.code}: ${result.error.message}`);
    } finally { this.submitting = false; }
  }
  async cancel(): Promise<void> {
    const result = await this.session().cancel();
    if (!result.ok) throw Error(`${result.error.code}: ${result.error.message}`);
  }
  dispose() { this.disposed = true; }
}

/** Fork only at a durable message boundary, never at a synthetic/live anchor. */
export async function forkNativeMessage(service: ForkService, sessionId: string, node: NativeNode): Promise<string> {
  const data = node.data as { seq?: unknown; finalNode?: { seq?: unknown } };
  const seq = node.kind === "assistant-step" ? data?.finalNode?.seq : ["user", "steering"].includes(node.kind) ? data?.seq : undefined;
  if (typeof seq !== "number" || !Number.isSafeInteger(seq) || seq < 0) throw Error("Wait for a durable message before creating a branch");
  return service.fork({ sessionId, atSeq: seq, increaseTitle: true });
}
