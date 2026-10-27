import type { ExternalFiles } from "./change-tracker";
import { getRuntimeRequire } from "./runtime-require";

type Fs = typeof import("node:fs").promises;
type PathModule = typeof import("node:path");
type ExecFile = typeof import("node:child_process").execFile;

export const MAX_SHELL_OUTPUT = 30_000;
const MAX_TRACKED_BYTES = 512 * 1024;

export interface ShellResult { code: number | null; stdout: string; stderr: string; timedOut: boolean }

/** Desktop-only access to this computer, the way a local agent sees it. */
export interface LocalHost {
  fs: Fs;
  path: PathModule;
  home: string;
  platform: string;
  isRoot: boolean;
  exec(command: string, options: { cwd: string; timeoutMs: number; signal: AbortSignal }): Promise<ShellResult>;
  /** Moves to the system trash; never deletes outright. */
  trash(path: string): Promise<void>;
}

interface ProcessLike { env: Record<string, string | undefined>; platform: string; getuid?: () => number }

let resolvedPath: Promise<string | null> | null = null;

/**
 * Many setups (Homebrew, nvm) add to PATH in .zshrc, which only interactive shells read.
 * Ask one interactive shell once, the way editors resolve the shell environment, and reuse it.
 */
function userPath(execFile: ExecFile, shell: string): Promise<string | null> {
  resolvedPath ??= new Promise((resolve) => {
    execFile(shell, ["-lic", 'printf "__QA_PATH__%s__QA_END__" "$PATH"'], { timeout: 5_000, encoding: "utf8", windowsHide: true }, (_error, stdout) => {
      resolve(/__QA_PATH__(.*?)__QA_END__/s.exec(String(stdout ?? ""))?.[1] || null);
    });
  });
  return resolvedPath;
}

interface ElectronLike { shell?: { trashItem?: (path: string) => Promise<void> } }

export function localHost(): LocalHost | null {
  const load = getRuntimeRequire();
  const proc = (globalThis as { process?: ProcessLike }).process;
  if (!load || !proc) return null;
  try {
    const fs = (load("fs") as { promises: Fs }).promises;
    const path = load("path") as PathModule;
    const home = (load("os") as { homedir(): string }).homedir();
    const execFile = (load("child_process") as { execFile: ExecFile }).execFile;
    const electron = (() => { try { return load("electron") as ElectronLike; } catch { return null; } })();
    const windows = proc.platform === "win32";
    return {
      fs, path, home, platform: proc.platform, isRoot: proc.getuid?.() === 0,
      // Commands run in a login shell with the user's interactive PATH, which Obsidian's own process lacks.
      exec: async (command, { cwd, timeoutMs, signal }) => {
        const shell = windows ? proc.env.ComSpec || "cmd.exe" : proc.env.SHELL || (proc.platform === "darwin" ? "/bin/zsh" : "/bin/sh");
        const args = windows ? ["/d", "/s", "/c", command] : ["-lc", command];
        const path = windows ? null : await userPath(execFile, shell);
        const env = path ? { ...proc.env, PATH: path } : proc.env;
        return new Promise<ShellResult>((resolve) => execFile(shell, args, { cwd, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, windowsHide: true, env, signal, encoding: "utf8" }, (error, stdout, stderr) => {
          const failure = error as (Error & { code?: number | string; killed?: boolean; signal?: string }) | null;
          resolve({
            code: failure ? typeof failure.code === "number" ? failure.code : null : 0,
            stdout: String(stdout ?? ""), stderr: String(stderr ?? "") || (failure && typeof failure.code !== "number" ? failure.message : ""),
            timedOut: Boolean(failure?.killed && failure.signal === "SIGTERM" && !signal.aborted),
          });
        }));
      },
      trash: async (target) => {
        const trashItem = electron?.shell?.trashItem;
        if (!trashItem) throw new Error("当前环境无法使用系统废纸篓，已取消删除");
        await trashItem(target);
      },
    };
  } catch { return null; }
}

/** Reads and restores files outside the vault, so a full-access turn can be undone like a vault one. */
export function externalFiles(host: LocalHost | null = localHost()): ExternalFiles | null {
  if (!host) return null;
  return {
    read: async (path) => {
      const stat = await host.fs.stat(path).catch(() => null);
      if (!stat) return null;
      if (!stat.isFile() || stat.size > MAX_TRACKED_BYTES) throw new Error("not trackable");
      const data = await host.fs.readFile(path);
      if (data.subarray(0, 8192).includes(0)) throw new Error("binary");
      return data.toString("utf8");
    },
    write: async (path, content) => {
      await host.fs.mkdir(host.path.dirname(path), { recursive: true });
      await host.fs.writeFile(path, content, "utf8");
    },
    trash: (path) => host.trash(path),
  };
}
