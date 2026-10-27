import { afterEach, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const temporary: string[] = [];
afterEach(() => { for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }); });

it.each([false, true])("checks each actual worktree from a push hook (worktree override: %s) and rejects real untracked work", (overrideWorktree) => {
  const directory = mkdtempSync(join(tmpdir(), "agent-preflight-")); temporary.push(directory);
  const candidate = join(directory, "candidate"); const other = join(directory, "other worktree"); mkdirSync(candidate);
  const env = { ...process.env };
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_PREFIX"]) delete env[key];
  const git = (...args: string[]) => execFileSync("git", args, { cwd: candidate, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-b", "main"); git("config", "user.email", "qa@example.com"); git("config", "user.name", "Release QA");
  const files = {
    "manifest.json": { version: "1.0.0", minAppVersion: "1.11.4" },
    "package.json": { version: "1.0.0" },
    "package-lock.json": { version: "1.0.0", packages: { "": { version: "1.0.0" } } },
    "versions.json": { "1.0.0": "1.11.4" },
  };
  for (const [path, value] of Object.entries(files)) writeFileSync(join(candidate, path), JSON.stringify(value));
  git("add", "."); git("commit", "-m", "baseline"); git("update-ref", "refs/remotes/origin/main", "HEAD");
  git("worktree", "add", "-b", "other", other);
  writeFileSync(join(candidate, "new-source.txt"), "candidate-only change"); git("add", "."); git("commit", "-m", "candidate");
  const gitDir = git("rev-parse", "--absolute-git-dir");
  const hookEnv = { ...env, GIT_DIR: gitDir, GIT_INDEX_FILE: join(gitDir, "index"), ...(overrideWorktree ? { GIT_WORK_TREE: candidate } : {}) };
  const run = () => spawnSync(process.execPath, [resolve("scripts/release-preflight.mjs")], { cwd: candidate, env: hookEnv, encoding: "utf8" });
  const clean = run();
  expect(clean.stderr).toBe(""); expect(clean.status).toBe(0); expect(clean.stdout).toContain("all available worktrees clean");
  writeFileSync(join(other, "unfinished.txt"), "must be preserved");
  const dirty = run();
  expect(dirty.status).toBe(1); expect(dirty.stderr.replace(/\\/g, "/")).toContain(other.replace(/\\/g, "/")); expect(dirty.stderr).toContain("unfinished.txt");
}, 30_000);
