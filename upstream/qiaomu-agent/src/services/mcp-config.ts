import { connectionText as ct } from "../i18n/connection";
import { isPrivateHttpUrl, isLocalOrPrivateHost } from "./network-hosts";

export interface McpServerEntry {
  name: string;
  kind: "http" | "stdio";
  target: string;
  args: string[];
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function readMcpConfig(raw: string): Record<string, unknown> {
  const config = object(JSON.parse(raw || "{}"));
  if (!config) throw new Error("MCP 配置需要是 JSON 对象");
  if (config.mcpServers !== undefined && !object(config.mcpServers)) throw new Error("mcpServers 需要是对象");
  return config;
}

export function listMcpServers(raw: string): McpServerEntry[] {
  const servers = object(readMcpConfig(raw).mcpServers) ?? {};
  return Object.entries(servers).flatMap<McpServerEntry>(([name, value]) => {
    const server = object(value);
    if (!server) return [];
    if (typeof server.url === "string") return [{ name, kind: "http" as const, target: server.url, args: [] }];
    if (typeof server.command === "string") return [{ name, kind: "stdio" as const, target: server.command,
      args: Array.isArray(server.args) ? server.args.filter((arg): arg is string => typeof arg === "string") : [] }];
    return [];
  });
}

export function saveMcpServer(raw: string, entry: McpServerEntry, allowPrivateHttp = false): string {
  const name = entry.name.trim();
  if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(name)) throw new Error("名称请使用英文字母、数字、- 或 _，并以字母开头");
  const target = entry.target.trim();
  if (entry.kind === "http") {
    const url = new URL(target);
    if (isPrivateHttpUrl(target) && !allowPrivateHttp) throw new Error(ct("privateHttpRequired"));
    if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocalOrPrivateHost(url.hostname)))
      throw new Error("远程地址需要 HTTPS，本机或局域网可使用 HTTP");
  } else if (!target || /\s/.test(target)) throw new Error("请填写可执行命令；参数单独填写");
  const config = readMcpConfig(raw);
  const servers = object(config.mcpServers) ?? {};
  return JSON.stringify({ ...config, mcpServers: { ...servers, [name]: entry.kind === "http"
    ? { url: target } : { command: target, args: entry.args.filter(Boolean) } } }, null, 2);
}

export function removeMcpServer(raw: string, name: string): string {
  const config = readMcpConfig(raw);
  const servers = { ...(object(config.mcpServers) ?? {}) };
  delete servers[name];
  return JSON.stringify({ ...config, mcpServers: servers }, null, 2);
}

export function enabledMcpConfig(raw: string, disabled: string[]): Record<string, unknown> {
  const config = readMcpConfig(raw);
  const servers = object(config.mcpServers) ?? {};
  return { ...config, mcpServers: Object.fromEntries(Object.entries(servers).filter(([name]) => !disabled.includes(name))) };
}
