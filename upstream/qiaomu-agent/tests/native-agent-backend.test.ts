import { describe, expect, it } from "vitest";
import {
  acpLaunch,
  codexActivity,
  codexActivityLabel,
  diffStat,
  reasoningHeading,
  codexGeneratedAttachment,
  acpMcpServers,
  nativeTransportFor,
  nativeTransportLabel,
} from "../src/services/native-agent-backend";

describe("native agent transports", () => {
  it("routes Codex to App Server and supported agents to ACP", () => {
    expect(nativeTransportFor("codex")).toBe("app-server");
    expect(nativeTransportFor("kimi")).toBe("acp");
    expect(nativeTransportFor("qwen")).toBe("acp");
    expect(nativeTransportFor("cursor")).toBe("acp");
    expect(nativeTransportFor("cline")).toBe("acp");
    expect(nativeTransportFor("claude")).toBeNull();
    expect(nativeTransportFor("claude", "/bin/claude-agent-acp")).toBe("acp");
    expect(nativeTransportFor("grok")).toBeNull();
    expect(nativeTransportFor("grok", "/bin/grok")).toBe("acp");
    expect(nativeTransportLabel("codex")).toBe("App Server");
  });

  it("uses the documented ACP launch forms and permission posture", () => {
    expect(acpLaunch("kimi", "plan")).toEqual(["acp"]);
    expect(acpLaunch("opencode", "edit")).toEqual(["acp"]);
    expect(acpLaunch("cursor", "plan")).toEqual(["acp"]);
    expect(acpLaunch("cline", "plan")).toEqual(["--acp"]);
    expect(acpLaunch("qwen", "plan")).toEqual(["--acp", "--approval-mode", "plan"]);
    expect(acpLaunch("gemini", "edit")).toEqual(["--acp", "--approval-mode", "auto_edit"]);
    expect(acpLaunch("gemini", "full")).toEqual(["--acp", "--approval-mode", "auto_edit"]);
    expect(acpLaunch("grok", "plan")).toEqual(["--no-auto-update", "agent", "stdio"]);
    expect(acpLaunch("claude", "edit")).toEqual([]);
  });

  it("converts stdio and HTTP MCP servers into ACP descriptors", () => {
    expect(acpMcpServers({
      mcpServers: {
        local: { command: "npx", args: ["-y", "server"], env: { TOKEN: "secret" } },
        remote: { url: "https://example.com/mcp" },
      },
    })).toEqual([
      {
        name: "local",
        command: "npx",
        args: ["-y", "server"],
        env: [{ name: "TOKEN", value: "secret" }],
      },
      { type: "http", name: "remote", url: "https://example.com/mcp", headers: [] },
    ]);
  });
});

it("extracts generated images and image-view paths from Codex App Server items", () => {
  expect(codexGeneratedAttachment({ id: "image-1", result: "data:image/png;base64,AQID", savedPath: "/tmp/小狗.png" })).toEqual({
    id: "image-1", name: "小狗.png", mediaType: "image/png", size: 3, base64: "AQID", localPath: "/tmp/小狗.png",
  });
  expect(codexGeneratedAttachment({ id: "view-1", path: "file:///tmp/%E5%B0%8F%E7%8B%97.webp" })).toMatchObject({
    id: "view-1", name: "小狗.webp", mediaType: "image/webp", localPath: "file:///tmp/%E5%B0%8F%E7%8B%97.webp",
  });
  expect(codexGeneratedAttachment({ id: "empty" })).toBeNull();
});

describe("codexActivityLabel", () => {
  it("names steps by what they did instead of a generic kind", () => {
    expect(codexActivityLabel({ command: "/bin/zsh -lc 'rg -n \"Spotify\" notes'" }, "commandExecution")).toBe('rg -n "Spotify" notes');
    expect(codexActivityLabel({ command: "/bin/zsh -lc 'echo '\\''hi'\\'''" }, "commandExecution")).toBe("echo 'hi'");
    expect(codexActivityLabel({ command: "/bin/zsh -lc date" }, "commandExecution")).toBe("date");
    expect(codexActivityLabel({ command: "ls -la\n  ~/Music" }, "commandExecution")).toBe("ls -la ~/Music");
    expect(codexActivityLabel({ query: "仍是夏天 歌单" }, "webSearch")).toBe("仍是夏天 歌单");
    expect(codexActivityLabel({ server: "spotify", tool: "add_to_playlist" }, "mcpToolCall")).toBe("spotify · add_to_playlist");
    expect(codexActivityLabel({}, "commandExecution")).toBe("执行命令");
    expect(codexActivityLabel({ title: "自定义" }, "webSearch")).toBe("自定义");
  });
});

describe("codexActivity", () => {
  it("folds read-only commands into explore steps and keeps their output", () => {
    const step = codexActivity({ command: "/bin/zsh -lc 'rg -n Spotify notes && cat a.md'", aggregatedOutput: "a.md:1:Spotify\n", exitCode: 0,
      commandActions: [{ type: "search", command: "rg", query: "Spotify", path: "notes" }, { type: "read", command: "cat", name: "a.md", path: "/v/a.md" }] }, "commandExecution");
    expect(step).toMatchObject({ kind: "explore", label: "搜索 Spotify，读取 a.md", actions: [{ type: "search", target: "Spotify" }, { type: "read", target: "a.md" }] });
    expect(step.detail).toBe("$ rg -n Spotify notes && cat a.md\na.md:1:Spotify");
    const run = codexActivity({ command: "npm test", exitCode: 1, aggregatedOutput: "fail", commandActions: [{ type: "unknown", command: "npm test" }] }, "commandExecution");
    expect(run).toMatchObject({ kind: "command", label: "npm test", detail: "$ npm test\nfail\n退出码 1" });
  });
  it("counts an edit's lines and names its files", () => {
    const diff = "--- a/a.md\n+++ b/a.md\n@@\n-old\n+new\n+more";
    expect(diffStat(diff)).toEqual({ added: 2, removed: 1 });
    expect(codexActivity({ changes: [{ path: "/v/notes/a.md", kind: { type: "update" }, diff }] }, "fileChange")).toMatchObject({ kind: "edit", label: "a.md", added: 2, removed: 1 });
  });
  it("shows a reasoning summary's heading only once it is complete", () => {
    expect(reasoningHeading("**核对曲目")).toBe("");
    expect(reasoningHeading("**核对曲目清单**\n\n先看原文")).toBe("核对曲目清单");
  });
});
