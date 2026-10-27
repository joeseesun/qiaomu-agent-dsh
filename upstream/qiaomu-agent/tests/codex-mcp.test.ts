import { expect, it } from "vitest";
import { codexMcpAddArgs, parseCodexMcpList } from "../src/services/codex-mcp";

it("reads only safe Codex MCP status fields", () => {
  expect(parseCodexMcpList(JSON.stringify([{ name: "docs", enabled: true, transport: { type: "streamable_http", url: "https://example.com", http_headers: { Authorization: "secret" } } }]))).toEqual([
    { name: "docs", enabled: true, kind: "streamable_http" },
  ]);
});

it("passes MCP connection arguments without a shell", () => {
  expect(codexMcpAddArgs({ name: "docs", kind: "http", target: "https://example.com/mcp", args: [] })).toEqual(["mcp", "add", "docs", "--url", "https://example.com/mcp"]);
  expect(codexMcpAddArgs({ name: "local", kind: "stdio", target: "npx", args: ["-y", "example"] })).toEqual(["mcp", "add", "local", "--", "npx", "-y", "example"]);
});
