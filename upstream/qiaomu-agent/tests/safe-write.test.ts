import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => {
  class TAbstractFile { path = ""; }
  class TFile extends TAbstractFile { constructor(path: string) { super(); this.path = path; } }
  return { TFile, TAbstractFile, normalizePath: (p: string) => p.replace(/\/+/g, "/").replace(/^\/|\/$/g, ""), Platform: { isDesktopApp: true } };
});

import { TFile as HostTFile } from "obsidian";
/** The mocked TFile takes a path; the real type has no constructor arguments. */
const TFile = HostTFile as unknown as new (path: string) => HostTFile;
type TFile = HostTFile;
import { diffLines, diffStats, hunks, reverseUnifiedDiff } from "../src/services/line-diff";
import { applyRollback, planRollback, toVaultPath, TurnChangeTracker } from "../src/services/change-tracker";
import { acpFileIntents, codexApprovalPolicy, codexApprovalRequest, codexFileIntents, NativeAgentBackend } from "../src/services/native-agent-backend";
import type { ChatCallbacks } from "../src/types";

/** Minimal in-memory vault with the events and adapter calls the tracker uses. */
function fakeApp(initial: Record<string, string>) {
  const files = new Map(Object.entries(initial));
  const handlers = new Map<string, Array<(...args: unknown[]) => void>>();
  const emit = (event: string, ...args: unknown[]) => { for (const h of handlers.get(event) ?? []) h(...args); };
  const trashed: string[] = [];
  const app = {
    vault: {
      on: (event: string, handler: (...args: unknown[]) => void) => { handlers.set(event, [...(handlers.get(event) ?? []), handler]); return { event, handler }; },
      offref: (ref: { event: string; handler: unknown }) => handlers.set(ref.event, (handlers.get(ref.event) ?? []).filter((h) => h !== ref.handler)),
      getAbstractFileByPath: (path: string) => files.has(path) ? new TFile(path) : null,
      modify: async (file: TFile, content: string) => { files.set(file.path, content); },
      create: async (path: string, content: string) => { files.set(path, content); return new TFile(path); },
      createFolder: async () => undefined,
      adapter: {
        exists: async (path: string) => files.has(path) || [...files.keys()].some((f) => f.startsWith(`${path}/`)),
        stat: async (path: string) => ({ size: files.get(path)?.length ?? 0 }),
        read: async (path: string) => { const v = files.get(path); if (v === undefined) throw new Error("missing"); return v; },
        write: async (path: string, content: string) => { files.set(path, content); },
        remove: async (path: string) => { files.delete(path); },
        mkdir: async () => undefined,
      },
    },
    fileManager: { trashFile: async (file: TFile) => { trashed.push(file.path); files.delete(file.path); } },
  };
  return { app: app as never, files, emit, trashed };
}

TurnChangeTracker.settleMs = 0;

describe("line diff", () => {
  it("finds changed lines, counts them and keeps context around hunks", () => {
    const diff = diffLines("a\nb\nc\nd\ne\nf\ng\nh\n", "a\nb\nC\nd\ne\nf\ng\nh\nnew\n");
    expect(diffStats(diff)).toEqual({ added: 2, removed: 1 });
    const shown = hunks(diff, 1);
    expect(shown.some((line) => line.type === "gap")).toBe(true);
    expect(diffLines(null, "x\n")).toEqual([{ type: "add", text: "x" }]);
  });

  it("reverses a Codex unified diff exactly as captured from the app server", () => {
    const after = "line one\nline 2\nline three\n";
    expect(reverseUnifiedDiff(after, "@@ -1,3 +1,3 @@\n line one\n-line two\n+line 2\n line three\n")).toBe("line one\nline two\nline three\n");
    expect(reverseUnifiedDiff("something else\n", "@@ -1,1 +1,1 @@\n-a\n+b\n")).toBeNull();
  });
});

describe("turn change tracking", () => {
  it("maps paths into the vault and refuses paths outside it", () => {
    expect(toVaultPath("/vault/notes/a.md", "/vault")).toBe("notes/a.md");
    expect(toVaultPath("notes/a.md", "/vault")).toBe("notes/a.md");
    expect(toVaultPath("/etc/passwd", "/vault")).toBeNull();
    expect(toVaultPath("../x.md", "/vault")).toBeNull();
  });

  it("records exact before-content for announced writes and lists unannounced ones as untracked", async () => {
    const { app, files, emit } = fakeApp({ "a.md": "old a", "b.md": "old b", "active.md": "draft" });
    const tracker = new TurnChangeTracker(app, "/vault", new Map([["active.md", "draft"]]));
    tracker.start();
    tracker.intent("/vault/a.md");            // read before the write
    tracker.intent("/vault/new.md", null);    // agent says it is new
    tracker.intent("/outside/x.md");
    await Promise.resolve(); await Promise.resolve();
    files.set("a.md", "new a"); emit("modify", new TFile("a.md"));
    files.set("new.md", "hello"); emit("create", new TFile("new.md"));
    files.set("b.md", "shell edit"); emit("modify", new TFile("b.md"));
    files.set("active.md", "draft + agent"); emit("modify", new TFile("active.md"));
    files.set(".qiaomu-agent/generated.png", "x"); emit("create", new TFile(".qiaomu-agent/generated.png"));
    const changes = await tracker.finish();
    const byPath = Object.fromEntries(changes.map((c) => [c.path, c]));
    expect(byPath["a.md"]).toMatchObject({ before: "old a", after: "new a", tracked: true });
    expect(byPath["new.md"]).toMatchObject({ before: null, after: "hello", tracked: true });
    expect(byPath["active.md"]).toMatchObject({ before: "draft", tracked: true });
    expect(byPath["b.md"]).toMatchObject({ tracked: false });
    expect(byPath["/outside/x.md"]).toMatchObject({ outside: true, tracked: false });
    expect(byPath[".qiaomu-agent/generated.png"]).toBeUndefined();
  });

  it("falls back to reversing the reported patch when the read raced the write", async () => {
    const { app, files, emit } = fakeApp({ "e.md": "line one\nline 2\nline three\n" });
    const tracker = new TurnChangeTracker(app, "/vault");
    tracker.start();
    tracker.intent("/vault/e.md", undefined, "@@ -1,3 +1,3 @@\n line one\n-line two\n+line 2\n line three\n");
    emit("modify", new TFile("e.md"));
    const [change] = await tracker.finish();
    expect(change).toMatchObject({ before: "line one\nline two\nline three\n", after: files.get("e.md"), tracked: true });
  });

  it("remembers what the agent read so a later untracked overwrite can still be undone", async () => {
    const { app, files, emit } = fakeApp({ "o.md": "v1" });
    const tracker = new TurnChangeTracker(app, "/vault");
    tracker.start();
    tracker.observe("/vault/o.md");
    await new Promise((resolve) => setTimeout(resolve, 0));
    files.set("o.md", "v2"); emit("modify", new TFile("o.md"));   // e.g. written through the Obsidian CLI
    const [change] = await tracker.finish();
    expect(change).toMatchObject({ path: "o.md", before: "v1", after: "v2", tracked: true });
  });

  it("an agent-reported before-text replaces our own read", async () => {
    const { app, files } = fakeApp({ "r.md": "already new" });
    const tracker = new TurnChangeTracker(app, "/vault");
    tracker.start();
    tracker.intent("/vault/r.md");
    tracker.intent("/vault/r.md", "original");
    files.set("r.md", "already new");
    const [change] = await tracker.finish();
    expect(change).toMatchObject({ before: "original", tracked: true });
  });

  it("classifies rollback safely and restores, recreates or trashes", async () => {
    const { app, files, trashed } = fakeApp({ "a.md": "new a", "c.md": "user edited", "n.md": "created" });
    const changes = [
      { path: "a.md", before: "old a", after: "new a", tracked: true },
      { path: "c.md", before: "old c", after: "agent c", tracked: true },
      { path: "n.md", before: null, after: "created", tracked: true },
      { path: "d.md", before: "deleted content", after: null, tracked: true },
      { path: "u.md", before: null, after: "x", tracked: false },
      { path: "r.md", before: "x", after: "y", tracked: true, reverted: true },
      { path: "gone.md", before: null, after: "created then deleted", tracked: true },
    ];
    const plan = await planRollback(app, changes);
    expect(plan.map((item) => [item.change.path, item.kind])).toEqual([["a.md", "safe"], ["c.md", "conflict"], ["n.md", "safe"], ["d.md", "safe"], ["u.md", "untracked"]]);
    const result = await applyRollback(app, plan.filter((item) => item.kind === "safe").map((item) => item.change));
    expect(result.failed).toEqual([]);
    expect(files.get("a.md")).toBe("old a");
    expect(files.get("c.md")).toBe("user edited");
    expect(trashed).toEqual(["n.md"]);
    expect(files.get("d.md")).toBe("deleted content");
  });
});

describe("agent protocol hooks", () => {
  it("extracts file intents from ACP diffs/locations and Codex patches", () => {
    expect(acpFileIntents({ kind: "edit", content: [{ type: "diff", path: "/v/a.md", oldText: "x", newText: "y" }, { type: "diff", path: "/v/new.md", newText: "z" }], locations: [{ path: "/v/a.md" }, { path: "/v/b.md" }] }))
      .toEqual([{ path: "/v/a.md", before: "x" }, { path: "/v/new.md", before: null }, { path: "/v/b.md" }]);
    expect(acpFileIntents({ kind: "read", locations: [{ path: "/v/a.md" }] })).toEqual([{ path: "/v/a.md", read: true }]);
    // OpenCode names the target only in rawInput while the edit is in progress.
    expect(acpFileIntents({ kind: "edit", status: "in_progress", locations: [], rawInput: { path: "/v/o.md", oldString: "a", newString: "b" } })).toEqual([{ path: "/v/o.md" }]);
    expect(codexFileIntents({ changes: [
      { path: "/v/e.md", kind: { type: "update", move_path: null }, diff: "@@ -1 +1 @@\n-a\n+b\n" },
      { path: "/v/n.md", kind: { type: "add" }, diff: "hello\n" },
      { path: "/v/d.md", kind: { type: "delete" }, diff: "?" },
      { path: "/v/m.md", kind: { type: "update", move_path: "/v/moved.md" }, diff: "" },
    ] })).toEqual([
      { path: "/v/e.md", patch: "@@ -1 +1 @@\n-a\n+b\n" }, { path: "/v/n.md", before: null }, { path: "/v/d.md" }, { path: "/v/m.md" }, { path: "/v/moved.md", before: null },
    ]);
  });

  it("only writable Codex turns may ask for escalation", () => {
    expect(codexApprovalPolicy("plan")).toBe("never");
    expect(codexApprovalPolicy("edit")).toBe("on-request");
    expect(codexApprovalPolicy("full")).toBe("never");
    expect(codexApprovalRequest("item/commandExecution/requestApproval", { command: "rm -rf build", reason: "清理" }, "7")).toMatchObject({ id: "codex-7", title: "Codex 请求执行命令", detail: "rm -rf build\n清理" });
  });

  function backendWith(agent: string, mode: "plan" | "edit", callbacks: Partial<ChatCallbacks>) {
    const backend = new NativeAgentBackend({ id: agent, label: agent, command: agent, path: `/bin/${agent}`, version: "1", available: true, callable: true });
    const replies: Array<{ id: unknown; result?: unknown; error?: unknown }> = [];
    Object.assign(backend as object, {
      process: { respond: (id: unknown, result: unknown) => replies.push({ id, result }), reject: (id: unknown, _code: number, error: unknown) => replies.push({ id, error }), running: true },
      activeCallbacks: { onText: () => undefined, onStatus: () => undefined, ...callbacks },
      activePermissionMode: mode,
    });
    const handle = (id: number, method: string, params: unknown) => (backend as unknown as { handleServerRequest(id: number, method: string, params: unknown): void }).handleServerRequest(id, method, params);
    return { handle, replies };
  }
  const permission = { toolCall: { title: "运行 npm test", content: [] }, options: [
    { optionId: "o1", name: "Allow", kind: "allow_once" }, { optionId: "o2", name: "Always", kind: "allow_always" }, { optionId: "o3", name: "Reject", kind: "reject_once" },
  ] };

  it("asks the user for ACP permissions and forwards the chosen option", async () => {
    const requestApproval = vi.fn(async (_request: unknown) => "o2");
    const { handle, replies } = backendWith("qwen", "edit", { requestApproval });
    handle(1, "session/request_permission", permission);
    await vi.waitFor(() => expect(replies).toHaveLength(1));
    expect(requestApproval.mock.calls[0]![0]).toMatchObject({ title: "运行 npm test", options: [{ id: "o1", label: "允许一次" }, { id: "o2", label: "本次会话都允许" }, { id: "o3", label: "拒绝" }] });
    expect(replies[0]).toEqual({ id: 1, result: { outcome: { outcome: "selected", optionId: "o2" } } });
  });

  it("read-only turns reject without asking, and a dismissed card cancels", async () => {
    const requestApproval = vi.fn(async (_request: unknown) => null);
    const plan = backendWith("qwen", "plan", { requestApproval });
    plan.handle(2, "session/request_permission", permission);
    expect(requestApproval).not.toHaveBeenCalled();
    expect(plan.replies[0]).toEqual({ id: 2, result: { outcome: { outcome: "selected", optionId: "o3" } } });
    const edit = backendWith("qwen", "edit", { requestApproval });
    edit.handle(3, "session/request_permission", permission);
    await vi.waitFor(() => expect(edit.replies).toHaveLength(1));
    expect(edit.replies[0]).toEqual({ id: 3, result: { outcome: { outcome: "cancelled" } } });
  });

  it("answers Codex request_user_input and Claude's form elicitation through the question card, even in read-only turns", async () => {
    const requestUserInput = vi.fn(async (request: { questions: Array<{ id: string }> }) => ({ [request.questions[0]!.id]: ["理性"] }));
    const codex = backendWith("codex", "plan", { requestUserInput });
    codex.handle(6, "item/tool/requestUserInput", { questions: [{ id: "style", header: "风格", question: "哪种？", isOther: true, isSecret: false, options: [{ label: "轻松", description: "" }, { label: "理性", description: "" }] }] });
    await vi.waitFor(() => expect(codex.replies).toHaveLength(1));
    expect(codex.replies[0]).toEqual({ id: 6, result: { answers: { style: { answers: ["理性"] } } } });
    const claude = backendWith("qwen", "plan", { requestUserInput });
    claude.handle(7, "elicitation/create", { mode: "form", message: "哪种？", requestedSchema: { properties: { question_0: { type: "string", oneOf: [{ const: "轻松" }, { const: "理性" }] } } } });
    await vi.waitFor(() => expect(claude.replies).toHaveLength(1));
    expect(claude.replies[0]).toEqual({ id: 7, result: { action: "accept", content: { question_0: "理性" } } });
    const none = backendWith("codex", "edit", {});
    none.handle(8, "item/tool/requestUserInput", { questions: [{ id: "a", question: "?", options: null }] });
    expect(none.replies[0]).toEqual({ id: 8, result: { answers: {} } });
  });

  it("maps Codex approval choices to protocol decisions", async () => {
    const { handle, replies } = backendWith("codex", "edit", { requestApproval: async () => "allow_always" });
    handle(4, "item/commandExecution/requestApproval", { command: "npm test" });
    handle(5, "execCommandApproval", { command: ["ls"] });
    await vi.waitFor(() => expect(replies).toHaveLength(2));
    expect(replies).toEqual([{ id: 4, result: { decision: "acceptForSession" } }, { id: 5, result: { decision: "approved_for_session" } }]);
  });

  it("routes ACP file reads and writes through the host and blocks writes when read-only", async () => {
    const host = { readText: vi.fn(async () => "l1\nl2\nl3\nl4"), writeText: vi.fn(async () => undefined) };
    const edit = backendWith("gemini", "edit", { host });
    edit.handle(6, "fs/read_text_file", { path: "/v/a.md", line: 2, limit: 2 });
    edit.handle(7, "fs/write_text_file", { path: "/v/a.md", content: "new" });
    await vi.waitFor(() => expect(edit.replies).toHaveLength(2));
    expect(edit.replies).toContainEqual({ id: 6, result: { content: "l2\nl3" } });
    expect(edit.replies).toContainEqual({ id: 7, result: null });
    expect(host.writeText).toHaveBeenCalledWith("/v/a.md", "new");
    const plan = backendWith("gemini", "plan", { host });
    plan.handle(8, "fs/write_text_file", { path: "/v/a.md", content: "x" });
    await vi.waitFor(() => expect(plan.replies).toHaveLength(1));
    expect(plan.replies[0]).toMatchObject({ id: 8, error: "当前为只读模式，不能写入文件" });
  });
});
