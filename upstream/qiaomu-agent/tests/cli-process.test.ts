import { afterEach, describe, expect, it, vi } from "vitest";
import { win32 as path } from "node:path";
import { EventEmitter } from "node:events";
import { cliInvocation, getCliProcesses, windowsCliCandidates } from "../src/services/cli-process";
import { discoverLocalClis } from "../src/services/cli-discovery";
import { JsonRpcProcess } from "../src/services/json-rpc-process";

const state = vi.hoisted(() => ({ require: null as null | ((id: string) => unknown) }));
vi.mock("../src/services/runtime-require", () => ({ getRuntimeRequire: () => state.require }));
const bin = String.raw`C:\Users\Jane Doe\AppData\Roaming\npm`;
const node = String.raw`C:\Program Files\nodejs\node.exe`;
const script = path.join(bin, "node_modules", "agent", "bin.js");
const shim = String.raw`@ECHO off
SET dp0=%~dp0
SET "_prog=node"
endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%" "%dp0%\node_modules\agent\bin.js" %*`;

function fixture(files = new Map([[path.join(bin, "codex.cmd"), shim], [script, ""], [node, ""]])) {
  const env = { Path: `"${bin}";C:\\Program Files\\nodejs`, PATHEXT: ".EXE;.CMD;.BAT;.PS1", APPDATA: path.dirname(bin) };
  const spawn = vi.fn(() => Object.assign(new EventEmitter(), {
    stdin: { writable: true, write: vi.fn(), end: vi.fn() },
    stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn(), exitCode: null,
  }));
  const execFile = vi.fn((_command, _args, _options, callback) => callback(null, "1.2.3", ""));
  const modules: Record<string, unknown> = {
    process: { platform: "win32", env }, path,
    fs: { existsSync: (file: string) => Array.from(files.keys()).some((key) => key.toLowerCase() === file.toLowerCase()),
      readFileSync: (file: string) => files.get(Array.from(files.keys()).find((key) => key.toLowerCase() === file.toLowerCase()) ?? file), readdirSync: () => [] },
    os: { homedir: () => String.raw`C:\Users\Jane Doe` }, child_process: { spawn, execFile },
  };
  const require = (id: string) => modules[id];
  return { files, env, require, spawn, execFile };
}
afterEach(() => { state.require = null; vi.clearAllMocks(); });

describe("Windows npm CLI resolution (simulated on any host)", () => {
  it("resolves case-insensitive environment keys and PATHEXT without selecting extensionless/PowerShell files", () => {
    const f = fixture();
    f.files.set(path.join(bin, "codex"), ""); f.files.set(path.join(bin, "codex.PS1"), "");
    expect(windowsCliCandidates("codex", f.require)).toEqual([path.join(bin, "codex.CMD")]);
    expect(windowsCliCandidates(path.join(bin, "codex.cmd"), f.require)).toEqual([path.join(bin, "codex.cmd")]);
  });
  it("bypasses npm cmd with literal argv, including spaces, quotes, backslashes and shell syntax", () => {
    const f = fixture();
    const args = ['a "quoted" prompt', "C:\\Vault With Spaces\\", "& echo hacked | more > x", "%PATH% !VAR! ^ (x)", "line one\nline two", ""];
    expect(cliInvocation("codex", args, f.require)).toEqual({ command: node, args: [script, ...args] });
    const processes = getCliProcesses(f.require) as typeof import("node:child_process");
    processes.spawn("codex", args, { cwd: bin, env: f.env, shell: false });
    expect(f.spawn).toHaveBeenCalledWith(node, [script, ...args], { cwd: bin, env: f.env, shell: false });
    processes.execFile("codex", args, { timeout: 3500, maxBuffer: 1024, windowsHide: true }, () => {});
    expect(f.execFile.mock.calls[0]?.slice(0, 3)).toEqual([node, [script, ...args], { timeout: 3500, maxBuffer: 1024, windowsHide: true, shell: false }]);
  });
  it("prefers node.exe next to the npm shim and supports legacy %~dp0 syntax", () => {
    const f = fixture(); const localNode = path.join(bin, "node.exe"); f.files.set(localNode, "");
    f.files.set(path.join(bin, "codex.cmd"), shim.replace("%dp0%", "%~dp0"));
    expect(cliInvocation("codex", [], f.require)).toEqual({ command: localNode, args: [script] });
  });
  it("supports npm bat wrappers and the configured PATHEXT order", () => {
    const f = fixture();
    const wrapper = path.join(bin, "codex.bat");
    f.files.set(wrapper, shim);
    f.env.PATHEXT = ".BAT;.CMD;.EXE";
    expect(windowsCliCandidates("codex", f.require)[0]).toBe(path.join(bin, "codex.BAT"));
    expect(cliInvocation(wrapper, ["--version"], f.require)).toEqual({ command: node, args: [script, "--version"] });
  });
  it("starts native executables directly and respects the caller's environment", () => {
    const f = fixture();
    expect(cliInvocation(node, ["--version"], f.require)).toEqual({ command: node, args: ["--version"] });
    expect(() => cliInvocation("codex", [], f.require, { PATH: "C:\\missing" })).toThrow("not found");
  });
  it("fails closed for arbitrary batch scripts, missing scripts and missing Node", () => {
    const f = fixture(); f.files.set(path.join(bin, "codex.cmd"), "echo %* & do-something");
    expect(() => cliInvocation("codex", [], f.require)).toThrow("expected an npm Node shim");
    f.files.set(path.join(bin, "codex.cmd"), shim); f.files.delete(script);
    expect(() => cliInvocation("codex", [], f.require)).toThrow("entry not found");
    f.files.set(script, ""); f.files.delete(node);
    expect(() => cliInvocation("codex", [], f.require)).toThrow("Node.js executable not found");
  });
  it("detects an npm CLI and launches JSON-RPC through the same Node entry", async () => {
    const f = fixture(); state.require = f.require;
    // Windows fs is case insensitive; keep the shim available for uppercase PATHEXT.
    f.files.set(path.join(bin, "codex.cmd").toLowerCase(), shim);
    const detection = (await discoverLocalClis()).find((cli) => cli.id === "codex")!;
    expect(detection).toMatchObject({ available: true, callable: true, version: "1.2.3", path: path.join(bin, "codex.CMD") });
    const rpc = new JsonRpcProcess({ executablePath: detection.path!, args: ["app-server"], includeJsonRpc: true });
    rpc.start(); expect(rpc.running).toBe(true);
    expect(f.spawn).toHaveBeenCalledWith(node, [script, "app-server"], { env: undefined, windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"] });
  });
  it("detects all four reported npm CLIs and Claude ACP from APPDATA even outside PATH", async () => {
    const f = fixture();
    for (const command of ["claude", "codex", "gemini", "pi", "claude-agent-acp"]) f.files.set(path.join(bin, `${command}.cmd`), shim);
    f.env.Path = "C:\\Program Files\\nodejs";
    state.require = f.require;
    const found = await discoverLocalClis();
    for (const id of ["claude", "codex", "gemini", "pi"]) expect(found.find((cli) => cli.id === id)).toMatchObject({ available: true, callable: true });
    expect(found.find((cli) => cli.id === "claude")?.nativePath).toBe(path.join(bin, "claude-agent-acp.CMD"));
  });
  it("leaves POSIX calls untouched", () => {
    const child = { spawn: vi.fn(), execFile: vi.fn() };
    const require = (id: string) => id === "process" ? { platform: "darwin" } : child;
    expect(getCliProcesses(require)).toBe(child);
    expect(cliInvocation("claude", ["hello"], require)).toEqual({ command: "claude", args: ["hello"] });
  });
});
