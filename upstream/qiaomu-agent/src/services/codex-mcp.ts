import { getCliProcesses } from "./cli-process";
import { getRuntimeRequire } from "./runtime-require";
import type { McpServerEntry } from "./mcp-config";

interface CodexMcpServer { name: string; enabled: boolean; kind: string; }

export function parseCodexMcpList(raw: string): CodexMcpServer[] {
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value)) throw new Error("Codex 未返回连接列表");
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || typeof item.name !== "string") return [];
    const transport = item.transport && typeof item.transport === "object" ? item.transport : {};
    return [{ name: item.name, enabled: item.enabled === true, kind: typeof transport.type === "string" ? transport.type : "unknown" }];
  });
}

export function codexMcpAddArgs(entry: McpServerEntry): string[] {
  return entry.kind === "http" ? ["mcp", "add", entry.name, "--url", entry.target]
    : ["mcp", "add", entry.name, "--", entry.target, ...entry.args];
}

function execCodex(executable: string, args: string[]): Promise<string> {
  const require = getRuntimeRequire();
  if (!require) return Promise.reject(new Error("仅桌面端可读取 Codex 连接"));
  const child = getCliProcesses(require) as typeof import("child_process");
  return new Promise((resolve, reject) => child.execFile(executable, args, { timeout: 12000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
    if (error) reject(new Error(stderr.trim() || error.message));
    else resolve(stdout);
  }));
}

export async function listCodexMcp(executable: string): Promise<CodexMcpServer[]> {
  return parseCodexMcpList(await execCodex(executable, ["mcp", "list", "--json"]));
}

export async function addCodexMcp(executable: string, entry: McpServerEntry): Promise<void> {
  const existing = await listCodexMcp(executable);
  if (existing.some((server) => server.name === entry.name)) throw new Error("Codex 已有同名连接，请先在 Codex 中检查");
  await execCodex(executable, codexMcpAddArgs(entry));
}
