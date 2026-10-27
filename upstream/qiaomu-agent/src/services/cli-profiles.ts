import { activeNoteBlock, selectionBlock } from "./agent-prompt";
import { readingBlock } from "../integrations/reading-prompt";
import type { ChatRequest, CliProfile } from "../types";
import { attachmentContext } from "./attachments";

export function promptWithContext(request: ChatRequest): string {
  const sections: string[] = [];
  if (request.obsidianCli?.state === "ready") {
    const executable = JSON.stringify(request.obsidianCli.path);
    sections.push(
      `<obsidian_cli executable=${executable}>\n` +
        `The official Obsidian CLI is connected to the running app. Prefer it for vault-aware reads, search, properties, links, tasks, and link-safe moves. ` +
        (request.permissionMode !== "plan"
          ? request.permissionMode === "full"
            ? "Full filesystem access is explicitly enabled for this turn. Inspect targets first and do not use permanent deletion."
            : "Writes inside the current workspace are allowed for this turn, but inspect the target first and do not use permanent deletion."
          : "This turn is read-only: use only read, search, listing, and inspection commands; do not modify files or properties.") +
        `\nRun the executable from the vault working directory. CLI parameters use key=value syntax.\n</obsidian_cli>`
    );
  }
  if (request.skill) {
    sections.push(
      `<active_skill name="${request.skill.name}" path="${request.skill.path}">\n${request.skill.body}\n</active_skill>`
    );
  }
  const note = activeNoteBlock(request);
  if (note) sections.push(note);
  const selection = selectionBlock(request);
  if (selection) sections.push(selection);
  const reading = readingBlock(request.reading);
  if (reading) sections.push(reading);
  sections.push(request.prompt);
  const attached = attachmentContext(request);
  if (attached) sections.push(attached);
  return sections.join("\n\n");
}

function modelArgs(request: ChatRequest, flag = "--model"): string[] {
  return request.model?.trim() ? [flag, request.model.trim()] : [];
}

export const CLI_PROFILES: CliProfile[] = [
  {
    id: "codex",
    label: "Codex",
    commands: ["codex"],
    versionArgs: ["--version"],
    supportsMcpFile: false,
    buildArgs: (request) => [
      "exec",
      "--json",
      "--skip-git-repo-check",
      "--sandbox",
      request.permissionMode === "full" ? "danger-full-access" : request.permissionMode === "edit" ? "workspace-write" : "read-only",
      ...modelArgs(request, "--model"),
      `${request.systemPrompt}\n\n${promptWithContext(request)}`,
    ],
  },
  {
    id: "claude",
    label: "Claude Code",
    commands: ["claude"],
    versionArgs: ["--version"],
    supportsMcpFile: true,
    mcpFileFlag: "--mcp-config",
    buildArgs: (request, mcpFile) => [
      "--print",
      "--verbose",
      "--output-format",
      "stream-json",
      "--permission-mode",
      request.permissionMode !== "plan" ? "acceptEdits" : "plan",
      "--append-system-prompt",
      request.systemPrompt,
      ...modelArgs(request),
      ...(mcpFile ? ["--mcp-config", mcpFile, "--strict-mcp-config"] : []),
      promptWithContext(request),
    ],
  },
  {
    id: "kimi",
    label: "Kimi CLI",
    commands: ["kimi", "kimi-cli"],
    versionArgs: ["--version"],
    supportsMcpFile: true,
    mcpFileFlag: "--mcp-config-file",
    buildArgs: (request, mcpFile) => [
      "--print",
      "--output-format",
      "stream-json",
      ...(request.cwd ? ["--work-dir", request.cwd] : []),
      ...(request.permissionMode === "plan" ? ["--plan"] : []),
      ...modelArgs(request),
      ...(mcpFile ? ["--mcp-config-file", mcpFile] : []),
      "--prompt",
      `${request.systemPrompt}\n\n${promptWithContext(request)}`,
    ],
  },
  {
    id: "qwen",
    label: "Qwen Code",
    commands: ["qwen"],
    versionArgs: ["--version"],
    supportsMcpFile: true,
    mcpFileFlag: "--mcp-config",
    buildArgs: (request, mcpFile) => [
      "--output-format",
      "stream-json",
      "--approval-mode",
      request.permissionMode !== "plan" ? "auto-edit" : "plan",
      "--system-prompt",
      request.systemPrompt,
      ...modelArgs(request),
      ...(mcpFile ? ["--mcp-config", mcpFile] : []),
      promptWithContext(request),
    ],
  },
  {
    id: "grok",
    label: "Grok CLI",
    commands: ["grok"],
    versionArgs: ["version"],
    supportsMcpFile: false,
    buildArgs: (request) => [
      "--single",
      promptWithContext(request),
      "--output-format",
      "streaming-messages-json",
      "--include-partial-messages",
      "--permission-mode",
      request.permissionMode !== "plan" ? "acceptEdits" : "plan",
      "--system-prompt",
      request.systemPrompt,
      ...modelArgs(request),
    ],
  },
  {
    id: "opencode",
    label: "OpenCode",
    commands: ["opencode"],
    versionArgs: ["--version"],
    supportsMcpFile: false,
    buildArgs: (request) => [
      "run",
      "--format",
      "json",
      ...(request.permissionMode !== "plan" ? ["--auto"] : []),
      ...modelArgs(request),
      `${request.systemPrompt}\n\n${promptWithContext(request)}`,
    ],
  },
  {
    id: "pi",
    label: "Pi",
    commands: ["pi"],
    versionArgs: ["--version"],
    supportsMcpFile: false,
    buildArgs: (request) => [
      "--print",
      "--mode",
      "json",
      "--no-session",
      "--no-skills",
      ...(request.permissionMode === "plan" ? ["--tools", "read,grep,find,ls"] : []),
      "--append-system-prompt",
      request.systemPrompt,
      ...modelArgs(request),
      promptWithContext(request),
    ],
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    commands: ["gemini"],
    versionArgs: ["--version"],
    supportsMcpFile: false,
    buildArgs: (request) => [
      "--prompt",
      `${request.systemPrompt}\n\n${promptWithContext(request)}`,
      "--output-format",
      "stream-json",
      "--skip-trust",
      "--approval-mode",
      request.permissionMode !== "plan" ? "auto_edit" : "plan",
      ...modelArgs(request),
    ],
  },
  {
    id: "antigravity",
    label: "Antigravity CLI",
    commands: ["agy"],
    versionArgs: ["--version"],
    supportsMcpFile: false,
    buildArgs: (request) => [
      "-p", `${request.systemPrompt}\n\n${promptWithContext(request)}`,
      "--output-format", "stream-json",
      ...(request.model ? ["--model", request.model] : []),
    ],
  },
  ...([[
    "cursor", "Cursor CLI", ["cursor-agent", "agent"],
  ], [
    "cline", "Cline CLI", ["cline"],
  ], [
    "auggie", "Auggie CLI", ["auggie"],
  ], [
    "hermes", "Hermes Agent", ["hermes"],
  ], [
    "openclaw", "OpenClaw", ["openclaw"],
  ]] as const).map(([id, label, commands]): CliProfile => ({
    id, label, commands: [...commands], versionArgs: ["--version"], supportsMcpFile: false,
    buildArgs: () => [], // These agents are launched through ACP, not the generic CLI backend.
  })),
];

export function getCliProfile(id: string): CliProfile | undefined {
  return CLI_PROFILES.find((profile) => profile.id === id);
}
