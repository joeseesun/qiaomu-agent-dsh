import { describe, expect, it } from "vitest";
import { enabledMcpConfig, listMcpServers, removeMcpServer, saveMcpServer } from "../src/services/mcp-config";

describe("MCP connection configuration", () => {
  it("adds HTTP and local servers without losing existing configuration", () => {
    const original = JSON.stringify({ other: true, mcpServers: { existing: { command: "node", args: ["server.js"], env: { TOKEN: "kept" } } } });
    const added = saveMcpServer(original, { name: "docs", kind: "http", target: "https://example.com/mcp", args: [] });
    expect(listMcpServers(added)).toHaveLength(2);
    expect(JSON.parse(added).mcpServers.existing.env).toEqual({ TOKEN: "kept" });
    const local = saveMcpServer(added, { name: "files", kind: "stdio", target: "npx", args: ["-y", "server"] });
    expect(listMcpServers(local)).toContainEqual({ name: "files", kind: "stdio", target: "npx", args: ["-y", "server"] });
    expect(enabledMcpConfig(local, ["existing", "files"]).mcpServers).toEqual({ docs: { url: "https://example.com/mcp" } });
    expect(listMcpServers(removeMcpServer(local, "docs")).map((server) => server.name)).toEqual(["existing", "files"]);
  });

  it("rejects malformed names, insecure remote addresses and malformed JSON", () => {
    expect(() => saveMcpServer("{}", { name: "../../bad", kind: "http", target: "https://example.com", args: [] })).toThrow();
    expect(() => saveMcpServer("{}", { name: "remote", kind: "http", target: "http://example.com/mcp", args: [] })).toThrow();
    expect(() => saveMcpServer("{}", { name: "local", kind: "stdio", target: "npx -y", args: [] })).toThrow();
    expect(() => listMcpServers("{broken")).toThrow();
  });
});


it("saves confirmed private MCP without leaking consent into server config", () => {
  const entry = { name: "lan", kind: "http" as const, target: "http://192.168.1.20/mcp", args: [] };
  expect(JSON.parse(saveMcpServer("{}", entry, true)).mcpServers.lan).toEqual({ url: entry.target });
  expect(() => saveMcpServer("{}", { ...entry, target: "http://fda.gov/mcp" }, true)).toThrow();
});
