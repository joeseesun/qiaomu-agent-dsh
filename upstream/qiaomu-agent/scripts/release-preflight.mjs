import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

// Push hooks export repository-local variables. Clear them before using -C so each
// worktree is checked against its own HEAD/index, not the publishing checkout's.
const gitEnvironment = { ...process.env };
for (const name of execFileSync("git", ["rev-parse", "--local-env-vars"], { encoding: "utf8" }).trim().split(/\r?\n/)) delete gitEnvironment[name];
const git = (...args) => execFileSync("git", args, { encoding: "utf8", env: gitEnvironment }).trim();
const failures = [];
const worktrees = git("worktree", "list", "--porcelain").split("\n\n");
for (const entry of worktrees) {
  const path = entry.split("\n").find(line => line.startsWith("worktree "))?.slice(9);
  if (!path || !existsSync(path)) continue;
  const dirty = git("-C", path, "status", "--porcelain", "--untracked-files=all");
  if (dirty) failures.push(`Unreviewed changes in ${path}\n${dirty}`);
}
try { git("merge-base", "--is-ancestor", "origin/main", "HEAD"); }
catch { failures.push("Candidate does not include origin/main. Fetch and reconcile before releasing."); }
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const versions = JSON.parse(readFileSync("versions.json", "utf8"));
if (![pkg.version, lock.version, lock.packages[""].version].every(version => version === manifest.version) || versions[manifest.version] !== manifest.minAppVersion) failures.push("Release versions/minAppVersion are inconsistent.");
if (failures.length) { console.error(failures.join("\n\n")); process.exitCode = 1; }
else console.log(`Release ${manifest.version}: all available worktrees clean, candidate includes origin/main, versions consistent.`);
