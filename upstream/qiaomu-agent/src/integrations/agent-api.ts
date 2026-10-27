import { AGENT_PROTOCOL, CONTEXT_VERSION, type AgentApi, type AgentAskRequest, type AgentComposeRequest } from "./qiaomu-context";
import { sanitize } from "./reading-context";

export interface AgentApiHost {
  /** Attaches the context to the next message. */
  pin(snapshot: AgentAskRequest["context"]): void;
  /** Reveals the agent and focuses the composer, optionally with a draft. */
  open(prompt?: string): Promise<void>;
  /** Starts a new conversation with a draft and optionally sends it. */
  compose(prompt: string, submit: boolean): Promise<void>;
}

/** The object other plugins find at `app.plugins.plugins["qiaomu-agent"].api`. */
export function createAgentApi(host: AgentApiHost): AgentApi {
  return Object.freeze({
    protocol: AGENT_PROTOCOL,
    version: CONTEXT_VERSION,
    async ask(request: AgentAskRequest): Promise<void> {
      if (!request || typeof request !== "object" || !request.context) throw new Error("缺少上下文");
      host.pin(sanitize(request.context));
      await host.open(typeof request.prompt === "string" ? request.prompt.slice(0, 4000) : undefined);
    },
    async compose(request: AgentComposeRequest): Promise<void> {
      const prompt = typeof request?.prompt === "string" ? request.prompt.trim().slice(0, 4000) : "";
      if (!prompt) throw new Error("缺少问题");
      await host.compose(prompt, request.submit === true);
    },
  });
}
