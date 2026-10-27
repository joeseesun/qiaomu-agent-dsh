import { getCliProcesses, isWindowsRuntime, windowsCliCandidates, environmentValue } from "./cli-process";
import { Platform } from "obsidian";
import type { CliDetection, CliProfile } from "../types";
import { CLI_PROFILES } from "./cli-profiles";
import { getRuntimeRequire } from "./runtime-require";

interface ChildProcessModule {
  execFile: (
    file: string,
    args: string[],
    options: { timeout: number; windowsHide: boolean; maxBuffer: number },
    callback: (error: NodeJS.ErrnoException | null, stdout: string, stderr: string) => void
  ) => void;
}

interface FileSystemModule {
  existsSync(path: string): boolean;
  readdirSync(path: string): string[];
}

interface OsModule {
  homedir(): string;
}

interface PathModule {
  join(...parts: string[]): string;
}

function knownPaths(profile: CliProfile, home: string, join: PathModule["join"], nvmBins: string[] = []): string[] {
  const names = profile.commands;
  const paths = names.flatMap((name) => [
    join(home, ".local", "bin", name),
    join(home, ".grok", "bin", name),
    join(home, ".bun", "bin", name),
    join("/opt/homebrew/bin", name),
    join("/usr/local/bin", name),
    ...nvmBins.map((bin) => join(bin, name)),
  ]);
  if (profile.id === "codex") {
    paths.unshift("/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex", "/Applications/ChatGPT.app/Contents/Resources/codex");
  }
  return paths;
}

async function probe(
  execFile: ChildProcessModule["execFile"],
  command: string,
  args: string[]
): Promise<{ ok: boolean; version: string | null; output: string }> {
  return await new Promise((resolve) => {
    try {
      execFile(
        command,
        args,
        { timeout: 3_500, windowsHide: true, maxBuffer: 128 * 1024 },
        (error, stdout, stderr) => {
          if (error) {
            resolve({ ok: false, version: null, output: "" });
            return;
          }
          const output = `${stdout || ""}\n${stderr || ""}`.trim();
          const version = output.split(/\r?\n/)[0]?.trim() || null;
          resolve({ ok: true, version, output });
        }
      );
    } catch {
      resolve({ ok: false, version: null, output: "" });
    }
  });
}

let discovery: Promise<CliDetection[]> | null = null;

/** Concurrent refreshes share work; completed scans are never cached indefinitely. */
export async function discoverLocalClis(): Promise<CliDetection[]> {
  if (discovery) return discovery;
  const pending = scanLocalClis();
  discovery = pending;
  try { return await pending; }
  finally { if (discovery === pending) discovery = null; }
}

async function scanLocalClis(): Promise<CliDetection[]> {
  if (!Platform.isDesktopApp) return [];
  const require = getRuntimeRequire();
  if (!require) return [];

  const childProcess = getCliProcesses(require) as ChildProcessModule;
  const fs = require("fs") as FileSystemModule;
  const os = require("os") as OsModule;
  const path = require("path") as PathModule;
  const home = os.homedir();
  const windows = isWindowsRuntime(require);
  const env = (require("process") as { env: Record<string, string | undefined> }).env;
  const candidatesFor = (profile: CliProfile): string[] => windows
    ? profile.commands.flatMap((command) => [
        ...windowsCliCandidates(command, require),
        ...windowsCliCandidates(path.join(environmentValue(env, "APPDATA") ?? path.join(home, "AppData", "Roaming"), "npm", command), require),
        ...windowsCliCandidates(path.join(home, ".local", "bin", command), require),
      ])
    : [...profile.commands, ...knownPaths(profile, home, path.join, nvmBins)];
  const nvm = path.join(home, ".nvm/versions/node");
  let versions: string[] = [];
  try { versions = fs.readdirSync(nvm).sort((a, b) => b.localeCompare(a, undefined, { numeric: true })); } catch { /* optional runtime location */ }
  const nvmBins = versions.map((version) => path.join(nvm, version, "bin"));
  const nodePaths = ["node", "/opt/homebrew/bin/node", "/usr/local/bin/node", ...nvmBins.map((bin) => path.join(bin, "node"))];

  const probes = new Map<string, ReturnType<typeof probe>>();
  const cachedProbe = (exec: ChildProcessModule["execFile"], command: string, args: string[]) => {
    const key = JSON.stringify([command, args]);
    let result = probes.get(key);
    if (!result) { result = probe(exec, command, args); probes.set(key, result); }
    return result;
  };
  const detect = async (profile: CliProfile): Promise<CliDetection> => {
    const candidates = candidatesFor(profile);
    let detection: CliDetection | null = null;
    for (const candidate of Array.from(new Set(candidates))) {
      if (candidate.includes("/") && !fs.existsSync(candidate)) continue;
      let executable = candidate;
      let argsPrefix: string[] | undefined;
      let result = await cachedProbe(childProcess.execFile, candidate, profile.versionArgs);
      // 桌面应用的 PATH 可能缺少 Node；优先用 Pi 同目录的运行时绕过 env shebang。
      if (!result.ok && profile.id === "pi" && candidate.includes("/")) {
        const siblingNode = path.join(candidate.slice(0, candidate.lastIndexOf("/")), "node");
        for (const node of new Set([siblingNode, ...nodePaths])) {
          if (node.includes("/") && !fs.existsSync(node)) continue;
          const viaNode = await cachedProbe(childProcess.execFile, node, [candidate, ...profile.versionArgs]);
          if (!viaNode.ok) continue;
          executable = node;
          argsPrefix = [candidate];
          result = viaNode;
          break;
        }
      }
      if (!result.ok) continue;
      if (profile.id === "cursor" && candidate.split(/[\\/]/).at(-1)?.replace(/\.(exe|com|cmd|bat)$/i, "") === "agent" && !/cursor/i.test(result.version ?? "")) continue;
      detection = {
        id: profile.id,
        label: profile.label,
        command: profile.commands[0] ?? profile.id,
        path: executable,
        ...(argsPrefix ? { argsPrefix } : {}),
        version: result.version,
        available: true,
        callable: true,
      };
      break;
    }
    if (profile.id === "claude" && detection) {
      for (const candidate of candidatesFor({ ...profile, commands: ["claude-agent-acp"] })) {
        if (candidate.includes("/") && !fs.existsSync(candidate)) continue;
        const result = await cachedProbe(childProcess.execFile, candidate, ["--version"]);
        if (result.ok) { detection.nativePath = candidate; break; }
        if (windows || !candidate.includes("/")) continue;
        for (const node of nodePaths) {
          if (node.includes("/") && !fs.existsSync(node)) continue;
          const viaNode = await cachedProbe(childProcess.execFile, node, [candidate, "--version"]);
          if (viaNode.ok) {
            detection.nativePath = node;
            detection.nativeArgsPrefix = [candidate];
            break;
          }
        }
        if (detection.nativePath) break;
      }
    }
    if (profile.id === "grok" && detection) {
      const native = await cachedProbe(childProcess.execFile, detection.path!, ["agent", "--help"]);
      if (native.ok && /stdio/.test(native.output)) detection.nativePath = detection.path!;
    }
    return detection ?? {
        id: profile.id,
        label: profile.label,
        command: profile.commands[0] ?? profile.id,
        path: null,
        version: null,
        available: false,
        callable: false,
      };
  };
  // Keep output/auto-selection order stable while bounding concurrent CLI startups.
  const detections = new Array<CliDetection>(CLI_PROFILES.length);
  let next = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < CLI_PROFILES.length) {
      const index = next++;
      detections[index] = await detect(CLI_PROFILES[index]!);
    }
  }));

  const zcode: CliDetection = { id: "zcode", label: "ZCode", command: "zcode", path: null, version: null, available: false, callable: false };
  // Prefer a standalone CLI. A desktop launcher must not be mistaken for a CLI.
  for (const candidate of [path.join(home, ".local/bin/zcode"), "/opt/homebrew/bin/zcode", "/usr/local/bin/zcode"]) {
    if (!fs.existsSync(candidate)) continue;
    const result = await cachedProbe(childProcess.execFile, candidate, ["--help"]);
    if (result.ok && result.version?.match(/^zcode \d/i)) {
      Object.assign(zcode, { path: candidate, version: result.version, available: true, callable: true });
      const native = await cachedProbe(childProcess.execFile, candidate, ["app-server", "--help"]);
      if (native.ok && /app-server/i.test(native.output)) zcode.nativePath = candidate;
      break;
    }
  }
  for (const app of ["/Applications/ZCode.app", path.join(home, "Applications/ZCode.app")]) {
    if (zcode.callable || !fs.existsSync(app)) continue;
    zcode.available = true;
    zcode.note = "已安装 ZCode，未找到可用的内置 CLI 或 Node.js 24+";
    const script = path.join(app, "Contents/Resources/glm/zcode.cjs");
    const config = path.join(app, "Contents/Resources/config/provider/zcode-builtin.json");
    if (!fs.existsSync(script) || !fs.existsSync(config)) continue;
    for (const node of nodePaths) {
      if (node.includes("/") && !fs.existsSync(node)) continue;
      const runtime = await cachedProbe(childProcess.execFile, node, ["--version"]);
      if (!runtime.ok || Number(runtime.version?.match(/^v(\d+)/)?.[1] ?? 0) < 24) continue;
      const cli = await cachedProbe(childProcess.execFile, node, [script, "--version"]);
      if (!cli.ok) continue;
      Object.assign(zcode, { path: node, argsPrefix: [script], version: cli.version, callable: true,
        env: { ZCODE_BUILTIN_PROVIDER_CONFIG_FILE: config, ZCODE_PERSONAL_PROVIDER_CONFIG_FILE: path.join(home, ".zcode/v2/provider_config.json") },
        note: "使用 ZCode 当前模型" });
      const native = await cachedProbe(childProcess.execFile, node, [script, "app-server", "--help"]);
      if (native.ok && /app-server/i.test(native.output)) zcode.nativePath = node;
      break;
    }
  }
  detections.push(zcode);

  return detections;
}
