import { FileSystemAdapter, Platform, type App, type TFile } from "obsidian";
import type { AgentSkill } from "../types";
import { getRuntimeRequire } from "./runtime-require";
import { parseSkillFrontmatter } from "../utils";

const VAULT_SKILL_PREFIXES = [".agents/skills/", ".claude/skills/", ".codex/skills/", ".gemini/skills/"];

interface FileSystemModule {
  existsSync(path: string): boolean;
  readdirSync(path: string, options: { withFileTypes: true }): Array<{
    name: string;
    isDirectory(): boolean;
    isFile(): boolean;
    isSymbolicLink(): boolean;
  }>;
  readFileSync(path: string, encoding: "utf8"): string;
  realpathSync(path: string): string;
}

interface PathModule {
  join(...parts: string[]): string;
  resolve(...parts: string[]): string;
}

export class SkillService {
  private skills: AgentSkill[] = [];

  constructor(private readonly app: App) {}

  list(): AgentSkill[] {
    return [...this.skills];
  }

  find(name: string): AgentSkill | undefined {
    return this.skills.find((skill) => skill.name === name);
  }

  async refresh(externalDirectories: string[]): Promise<AgentSkill[]> {
    const discovered = new Map<string, AgentSkill>();
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (file.name !== "SKILL.md") continue;
      if (!VAULT_SKILL_PREFIXES.some((prefix) => file.path.startsWith(prefix))) continue;
      const skill = await this.readVaultSkill(file);
      if (skill) discovered.set(skill.path, skill);
    }

    for (const directory of [...this.defaultDirectories(), ...externalDirectories]) {
      for (const skill of this.readExternalSkills(directory)) {
        if (!discovered.has(skill.path)) discovered.set(skill.path, skill);
      }
    }

    this.skills = [...discovered.values()].sort((a, b) => a.name.localeCompare(b.name));
    return this.list();
  }

  defaultDirectories(): string[] {
    if (!Platform.isDesktopApp) return [];
    const require = getRuntimeRequire();
    if (!require) return [];
    const os = require("os") as { homedir(): string };
    const path = require("path") as PathModule;
    const fs = require("fs") as FileSystemModule;
    const home = os.homedir();
    const personalRoot = path.join(home, "Nutstore Files", ".agents", "skills");
    const primaryRoot = fs.existsSync(personalRoot) ? personalRoot : path.join(home, ".agents", "skills");
    return [
      primaryRoot,
      path.join(home, ".agents", "skills"),
      path.join(home, ".claude", "skills"),
      path.join(home, ".codex", "skills"),
      path.join(home, ".cursor", "skills"),
      path.join(home, ".config", "opencode", "skills"),
      path.join(home, ".pi", "agent", "skills"),
      path.join(home, ".skills-manager", "skills"),
    ];
  }

  private async readVaultSkill(file: TFile): Promise<AgentSkill | null> {
    const markdown = await this.app.vault.cachedRead(file);
    const parsed = parseSkillFrontmatter(markdown);
    if (!parsed) return null;
    return { ...parsed, path: file.path, source: "vault" };
  }

  private readExternalSkills(directory: string): AgentSkill[] {
    const require = getRuntimeRequire();
    if (!require || !directory.trim()) return [];
    const fs = require("fs") as FileSystemModule;
    const path = require("path") as PathModule;
    if (!fs.existsSync(directory)) return [];

    const results: AgentSkill[] = [];
    const visit = (current: string, depth: number): void => {
      if (depth > 2) return;
      let entries: ReturnType<FileSystemModule["readdirSync"]>;
      try {
        entries = fs.readdirSync(current, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory() || entry.isSymbolicLink()) {
          visit(fullPath, depth + 1);
        } else if (entry.isFile() && entry.name === "SKILL.md") {
          try {
            const parsed = parseSkillFrontmatter(fs.readFileSync(fullPath, "utf8"));
            if (parsed) results.push({ ...parsed, path: fs.realpathSync(fullPath), source: "external" });
          } catch {
            // An unreadable skill should not block the rest of the catalog.
          }
        }
      }
    };
    visit(directory, 0);
    return results;
  }

  getVaultRoot(): string | null {
    if (!Platform.isDesktopApp) return null;
    const adapter = this.app.vault.adapter;
    // normalizePath is for vault-relative paths and strips the leading slash from macOS paths.
    // Native agents need the adapter's absolute filesystem path as their cwd/sandbox root.
    return adapter instanceof FileSystemAdapter ? adapter.getBasePath() : null;
  }
}
