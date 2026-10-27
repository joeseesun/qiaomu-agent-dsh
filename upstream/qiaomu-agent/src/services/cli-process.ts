import type { ChildProcess, ExecFileOptionsWithStringEncoding, SpawnOptions } from "node:child_process";

export type RuntimeRequire = (id: string) => unknown;
type Environment = Record<string, string | undefined>;

export function environmentValue(env: Environment, name: string): string | undefined {
  return env[Object.keys(env).find((key) => key.toLowerCase() === name.toLowerCase()) ?? name];
}

export function isWindowsRuntime(require: RuntimeRequire): boolean {
  return (require("process") as { platform?: string }).platform === "win32";
}

/** Resolve only launchable file types. Never run a PATH entry through a shell. */
export function windowsCliCandidates(command: string, require: RuntimeRequire, env?: Environment): string[] {
  const path = require("path") as typeof import("node:path");
  const fs = require("fs") as typeof import("node:fs");
  const environment = env ?? (require("process") as { env: Environment }).env;
  const extensions = (environmentValue(environment, "PATHEXT") ?? ".COM;.EXE;.BAT;.CMD").split(";").map((extension) => extension.trim())
    .filter((extension) => /^\.(exe|com|cmd|bat)$/i.test(extension));
  const names = path.extname(command) ? [command] : extensions.map((extension) => `${command}${extension}`);
  const directories = /[\\/]|^[a-z]:/i.test(command) ? [""] : (environmentValue(environment, "PATH") ?? "").split(";")
    .map((entry) => entry.replace(/^"(.*)"$/, "$1")).filter(Boolean);
  return directories.flatMap((directory) => names.map((name) => directory ? path.join(directory, name) : name))
    .map((candidate) => path.resolve(candidate))
    .filter((candidate) => fs.existsSync(candidate));
}

export interface CliInvocation { command: string; args: string[]; }

/** npm's Windows shim points at a local JS entry. Bypass cmd.exe entirely, so
 * %, !, quotes, newlines and shell metacharacters remain literal arguments.
 * Arbitrary batch scripts cannot safely accept untrusted prompts and fail closed.
 */
export function cliInvocation(command: string, args: string[], require: RuntimeRequire, env?: Environment): CliInvocation {
  if (!isWindowsRuntime(require)) return { command, args };
  const path = require("path") as typeof import("node:path");
  const fs = require("fs") as typeof import("node:fs");
  const resolved = windowsCliCandidates(command, require, env)[0];
  if (!resolved) throw new Error(`CLI executable not found: ${command}`);
  if (/\.(exe|com)$/i.test(resolved)) return { command: resolved, args };
  if (!/\.(cmd|bat)$/i.test(resolved)) throw new Error(`Unsupported Windows CLI executable: ${resolved}`);
  const shim = fs.readFileSync(resolved, "utf8");
  // cmd-shim's Node launcher, including old %~dp0 and current %dp0% variants.
  const entry = shim.match(/"%_prog%"\s+"%(?:dp0%|~dp0)[\\/]([^"\r\n]+)"\s+%\*/i)?.[1];
  if (!entry || !/^node_modules[\\/]/i.test(entry) || !/\.(?:[cm]?js)$/i.test(entry)) {
    throw new Error(`Unsupported Windows CLI wrapper (expected an npm Node shim): ${resolved}`);
  }
  const script = path.resolve(path.dirname(resolved), entry);
  if (!fs.existsSync(script)) throw new Error(`npm CLI entry not found: ${script}`);
  const localNode = path.join(path.dirname(resolved), "node.exe");
  const node = fs.existsSync(localNode) ? localNode : windowsCliCandidates("node.exe", require, env)[0];
  if (!node) throw new Error("Node.js executable not found for npm CLI");
  return { command: node, args: [script, ...args] };
}

/** Discovery and every Agent backend use the same resolution and argv rules. */
export function getCliProcesses(require: RuntimeRequire): unknown {
  const child = require("child_process") as typeof import("node:child_process");
  if (!isWindowsRuntime(require)) return child;
  return {
    ...child,
    spawn: (command: string, args: string[], options: SpawnOptions = {}) => {
      const invocation = cliInvocation(command, args, require, options.env);
      return child.spawn(invocation.command, invocation.args, { ...options, shell: false });
    },
    execFile: (command: string, args: string[], options: ExecFileOptionsWithStringEncoding, callback: (error: Error | null, stdout: string, stderr: string) => void): ChildProcess => {
      const invocation = cliInvocation(command, args, require, options.env);
      return child.execFile(invocation.command, invocation.args, { ...options, shell: false }, callback);
    },
  };
}
