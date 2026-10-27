import { getCliProcesses } from "./cli-process";
import type { ChatBackend, ChatCallbacks, ChatRequest, CliDetection } from "../types";
import { promptWithContext } from "./cli-profiles";
import { getRuntimeRequire } from "./runtime-require";
import { ZcodeAppServer } from "./zcode-app-server";
import { zcodeError } from "./zcode-errors";
export { zcodeError } from "./zcode-errors";

export function zcodeArgs(request: ChatRequest): string[] {
  if (request.model?.trim()) throw new Error("请在 ZCode 中选择模型，插件使用它的默认模型");
  const history = request.history.filter(m => m.role === "user" || m.role === "assistant").slice(-20).map(m => m.role + ": " + m.content).join("\n\n");
  return ["--prompt", [request.systemPrompt, history, promptWithContext(request)].filter(Boolean).join("\n\n"),
    "--json", "--mode", request.permissionMode === "full" ? "yolo" : request.permissionMode,
    ...(request.cwd ? ["--cwd", request.cwd] : [])];
}

export function zcodeResponse(stdout: string): string {
  let value: { response?: unknown; projection?: { status?: string } };
  try { value = JSON.parse(stdout); } catch { throw new Error("ZCode 未返回有效的 JSON 结果"); }
  if (!value || typeof value.response !== "string") throw new Error("ZCode 未返回可显示的回复");
  if (["failed", "error", "cancelled"].includes(value.projection?.status ?? "")) throw new Error(value.response || "ZCode 任务未完成");
  return value.response;
}

interface Child { kill(signal: string): boolean; exitCode?: number | null; }
interface Processes {
  execFile(command: string, args: string[], options: object, callback: (error: Error | null, stdout: string, stderr: string) => void): Child;
}

/** ZCode 0.16.x JSON summary interface; approvals fail closed in headless mode. */
export class ZcodeBackend implements ChatBackend {
  readonly id = "cli:zcode";
  readonly label = "ZCode";
  private active = new Set<AbortController>();
  private native: ZcodeAppServer | null;
  constructor(private readonly detection: CliDetection) { this.native = detection.nativePath ? new ZcodeAppServer(detection) : null; }
  async prepare(request: ChatRequest): Promise<void> { await this.native?.prepare(request); }
  resetSession(): void { this.native?.resetSession(); }
  async shutdown(): Promise<void> { for (const controller of this.active) controller.abort(); await this.native?.shutdown(); }
  async send(request: ChatRequest, callbacks: ChatCallbacks, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    if (this.native) {
      try { await this.native.send(request, callbacks, signal); return; }
      catch (error) {
        if (!this.native.canFallback || signal.aborted) throw error;
        await this.native.shutdown();
        this.native = null;
        callbacks.onStatus("ZCode App Server 不可用，改用 CLI…");
      }
    }
    const require = getRuntimeRequire();
    if (!require || !this.detection.path) throw new Error("ZCode 需要桌面端的可用 CLI");
    const args = [...(this.detection.argsPrefix ?? []), ...zcodeArgs(request)];
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal.addEventListener("abort", cancel, { once: true });
    this.active.add(controller);
    const runtime = require("process") as { env: Record<string, string | undefined> };
    callbacks.onStatus("正在通过 ZCode 处理，完成后显示回复…");
    try {
      const output = await new Promise<string>((resolve, reject) => {
        let killTimer: ReturnType<typeof setTimeout> | undefined;
        const child = (getCliProcesses(require) as Processes).execFile(this.detection.path!, args, {
          cwd: request.cwd ?? undefined, env: { ...runtime.env, ...this.detection.env },
          windowsHide: true, shell: false, encoding: "utf8", maxBuffer: 8 * 1024 * 1024, timeout: 300_000,
        }, (error, stdout, stderr) => {
          if (killTimer) clearTimeout(killTimer);
          controller.signal.removeEventListener("abort", abort);
          if (controller.signal.aborted) reject(new DOMException("已取消", "AbortError"));
          else if (error) reject(new Error(zcodeError(stderr, error.message)));
          else resolve(stdout);
        });
        const abort = () => {
          child.kill("SIGTERM");
          killTimer = setTimeout(() => { if (child.exitCode == null) child.kill("SIGKILL"); }, 2000);
        };
        controller.signal.addEventListener("abort", abort, { once: true });
        if (controller.signal.aborted) abort();
      });
      controller.signal.throwIfAborted();
      callbacks.onText(zcodeResponse(output));
    } finally {
      signal.removeEventListener("abort", cancel);
      this.active.delete(controller);
    }
  }
}
