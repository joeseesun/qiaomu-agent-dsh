export type ObsidianCliOperation =
  | { type: "daily-path" }
  | { type: "daily-open" }
  | { type: "read"; path: string }
  | { type: "search"; query: string; folder?: string; limit?: number }
  | { type: "append"; path: string; content: string; inline?: boolean }
  | { type: "prepend"; path: string; content: string; inline?: boolean }
  | { type: "create"; path: string; content: string; overwrite?: boolean }
  | { type: "property-set"; path: string; name: string; value: string; propertyType?: string };

function safeVaultPath(value: string): string {
  const path = value.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!path || path.startsWith("/") || path.split("/").includes("..")) {
    throw new Error("Obsidian CLI 目标必须是 Vault 内的相对路径");
  }
  return path;
}

export function buildObsidianCliArgs(operation: ObsidianCliOperation): string[] {
  switch (operation.type) {
    case "daily-path": return ["daily:path"];
    case "daily-open": return ["daily"];
    case "read":
      return ["read", `path=${safeVaultPath(operation.path)}`];
    case "search": {
      const args = ["search:context", `query=${operation.query}`, "format=json"];
      if (operation.folder) args.push(`path=${safeVaultPath(operation.folder)}`);
      if (operation.limit) args.push(`limit=${Math.max(1, Math.min(100, Math.floor(operation.limit)))}`);
      return args;
    }
    case "append":
      return ["append", `path=${safeVaultPath(operation.path)}`, `content=${operation.content}`, ...(operation.inline ? ["inline"] : [])];
    case "prepend":
      return ["prepend", `path=${safeVaultPath(operation.path)}`, `content=${operation.content}`, ...(operation.inline ? ["inline"] : [])];
    case "create":
      return ["create", `path=${safeVaultPath(operation.path)}`, `content=${operation.content}`, ...(operation.overwrite ? ["overwrite"] : [])];
    case "property-set":
      return [
        "property:set",
        `name=${operation.name}`,
        `value=${operation.value}`,
        ...(operation.propertyType ? [`type=${operation.propertyType}`] : []),
        `path=${safeVaultPath(operation.path)}`,
      ];
  }
}
