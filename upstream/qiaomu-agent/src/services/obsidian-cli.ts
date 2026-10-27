import { Platform } from "obsidian";
import type { ObsidianCliConnection } from "../types";
import { getRuntimeRequire } from "./runtime-require";
import { buildObsidianCliArgs, type ObsidianCliOperation } from "./obsidian-cli-args";

interface ChildProcessModule {
  execFile: (
    file: string,
    args: string[],
    options: { cwd?: string; timeout: number; windowsHide: boolean; maxBuffer: number },
    callback: (error: NodeJS.ErrnoException | null, stdout: string, stderr: string) => void
  ) => void;
}

interface FileSystemModule {
  existsSync(path: string): boolean;
}

const MAC_APP_CLI = "/Applications/Obsidian.app/Contents/MacOS/obsidian-cli";

function exec(
  childProcess: ChildProcessModule,
  file: string,
  args: string[],
  cwd?: string
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    childProcess.execFile(
      file,
      args,
      { ...(cwd ? { cwd } : {}), timeout: 5_000, windowsHide: true, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        const code = typeof error?.code === "number" ? error.code : error ? 1 : 0;
        resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() });
      }
    );
  });
}

export class ObsidianCliService {
  private connection: ObsidianCliConnection = {
    path: "",
    version: null,
    state: "unavailable",
    detail: "仅桌面端支持 Obsidian CLI",
  };

  getConnection(): ObsidianCliConnection {
    return { ...this.connection };
  }

  async detect(): Promise<ObsidianCliConnection> {
    if (!Platform.isDesktopApp) return this.getConnection();
    const require = getRuntimeRequire();
    if (!require) return this.getConnection();
    const fs = require("fs") as FileSystemModule;
    const childProcess = require("child_process") as ChildProcessModule;
    const candidates = ["obsidian", MAC_APP_CLI, "/usr/local/bin/obsidian", "/opt/homebrew/bin/obsidian"];

    for (const candidate of candidates) {
      if (candidate.includes("/") && !fs.existsSync(candidate)) continue;
      const result = await exec(childProcess, candidate, ["version"]);
      const output = `${result.stdout}\n${result.stderr}`.trim();
      if (/command line interface is not enabled/i.test(output)) {
        this.connection = {
          path: candidate,
          version: null,
          state: "disabled",
          detail: "已安装，但需在 Obsidian 设置 → 常规 → 高级中启用命令行界面",
        };
        return this.getConnection();
      }
      if (result.code === 0) {
        this.connection = {
          path: candidate,
          version: result.stdout || null,
          state: "ready",
          detail: result.stdout ? `已连接 ${result.stdout}` : "已连接",
        };
        return this.getConnection();
      }
    }

    this.connection = {
      path: "",
      version: null,
      state: "unavailable",
      detail: "未发现 Obsidian CLI；需要 1.12.7+ 安装程序并在设置中注册",
    };
    return this.getConnection();
  }

  async run(operation: ObsidianCliOperation, cwd: string): Promise<string> {
    if (this.connection.state !== "ready" || !this.connection.path) {
      throw new Error(this.connection.detail);
    }
    const require = getRuntimeRequire();
    if (!require) throw new Error("当前平台不能运行 Obsidian CLI");
    const result = await exec(
      require("child_process") as ChildProcessModule,
      this.connection.path,
      buildObsidianCliArgs(operation),
      cwd
    );
    if (result.code !== 0) throw new Error(result.stderr || "Obsidian CLI 执行失败");
    return result.stdout;
  }
}
