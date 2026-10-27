import { getCliProcesses } from "./cli-process";
import { getRuntimeRequire } from "./runtime-require";

export interface JsonRpcMessage {
  jsonrpc?: "2.0";
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number | string; message: string; data?: unknown };
}

interface ChildProcessLike {
  stdin: { writable: boolean; write(data: string): void; end(): void };
  stdout: { on(event: "data", listener: (chunk: Uint8Array) => void): void };
  stderr: { on(event: "data", listener: (chunk: Uint8Array) => void): void };
  on(event: "error", listener: (error: Error) => void): void;
  on(event: "exit", listener: (code: number | null, signal: string | null) => void): void;
  kill(signal?: string): boolean;
  killed?: boolean;
  exitCode?: number | null;
}

interface ChildProcessModule {
  spawn(
    command: string,
    args: string[],
    options: { cwd?: string; env?: Record<string, string | undefined>; windowsHide: boolean; shell: false; stdio: string[] }
  ): ChildProcessLike;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export interface JsonRpcProcessOptions {
  executablePath: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
  includeJsonRpc: boolean;
  onNotification?: (method: string, params: unknown) => void;
  onServerRequest?: (id: number | string, method: string, params: unknown) => void;
  onLog?: (message: string) => void;
  onClose?: (reason: string) => void;
}

export function splitJsonLines(buffer: string, chunk: string): { lines: string[]; rest: string } {
  const parts = `${buffer}${chunk}`.split(/\r?\n/);
  return { lines: parts.slice(0, -1).filter((line) => line.trim().length > 0), rest: parts.at(-1) ?? "" };
}

export class JsonRpcProcess {
  private child: ChildProcessLike | null = null;
  private nextId = 1;
  private pending = new Map<number | string, PendingRequest>();
  private stdoutBuffer = "";
  private stdoutDecoder = new TextDecoder();
  private stderrDecoder = new TextDecoder();
  private stderrTail = "";
  private closing = false;

  constructor(private readonly options: JsonRpcProcessOptions) {}

  get running(): boolean {
    return Boolean(this.child && !this.child.killed && this.child.exitCode === null);
  }

  start(): void {
    if (this.running) return;
    const require = getRuntimeRequire();
    if (!require) throw new Error("原生 Agent 协议仅支持桌面版 Obsidian");
    const childProcess = getCliProcesses(require) as ChildProcessModule;
    this.closing = false;
    this.stdoutBuffer = "";
    this.stdoutDecoder = new TextDecoder();
    this.stderrDecoder = new TextDecoder();
    this.stderrTail = "";
    const child = childProcess.spawn(this.options.executablePath, this.options.args, {
      ...(this.options.cwd ? { cwd: this.options.cwd } : {}),
      env: this.options.env,
      windowsHide: true,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    child.stdout.on("data", (chunk) => this.consumeStdout(this.stdoutDecoder.decode(chunk, { stream: true })));
    child.stderr.on("data", (chunk) => {
      const text = this.stderrDecoder.decode(chunk, { stream: true }).trim();
      if (!text) return;
      this.stderrTail = `${this.stderrTail}\n${text}`.slice(-12_000).trim();
      this.options.onLog?.(text);
    });
    child.on("error", (error) => this.handleClose(error.message));
    child.on("exit", (code, signal) => {
      const reason = signal ? `signal ${signal}` : `exit code ${String(code)}`;
      this.handleClose(this.stderrTail ? `${reason}: ${this.stderrTail}` : reason);
    });
  }

  request(method: string, params: unknown = {}, timeoutMs = 30_000): Promise<unknown> {
    if (!this.running) return Promise.reject(new Error("Agent 协议进程未运行"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} 请求超时`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      this.write({ id, method, params });
    });
  }

  notify(method: string, params: unknown = {}): void {
    this.write({ method, params });
  }

  respond(id: number | string, result: unknown): void {
    this.write({ id, result });
  }

  reject(id: number | string, code: number | string, message: string): void {
    this.write({ id, error: { code, message } });
  }

  async stop(): Promise<void> {
    const child = this.child;
    this.closing = true;
    this.child = null;
    this.rejectPending(new Error("Agent 协议进程已关闭"));
    if (!child || child.killed || child.exitCode !== null) return;
    child.stdin.end();
    child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
        resolve();
      }, 2_000);
      child.on("exit", () => { clearTimeout(timeout); resolve(); });
    });
  }

  private write(message: JsonRpcMessage): void {
    if (!this.child?.stdin.writable) throw new Error("Agent 协议 stdin 不可写");
    const payload = this.options.includeJsonRpc ? { jsonrpc: "2.0", ...message } : message;
    this.child.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  private consumeStdout(chunk: string): void {
    const parsed = splitJsonLines(this.stdoutBuffer, chunk);
    this.stdoutBuffer = parsed.rest;
    for (const line of parsed.lines) this.handleLine(line);
  }

  private handleLine(line: string): void {
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch {
      this.options.onLog?.(`忽略非 JSON 协议输出：${line.slice(0, 240)}`);
      return;
    }
    if (message.id !== undefined && message.method) {
      this.options.onServerRequest?.(message.id, message.method, message.params);
      return;
    }
    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timeout);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
      return;
    }
    if (message.method) this.options.onNotification?.(message.method, message.params);
  }

  private handleClose(reason: string): void {
    this.child = null;
    this.rejectPending(new Error(reason));
    if (!this.closing) this.options.onClose?.(reason);
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
