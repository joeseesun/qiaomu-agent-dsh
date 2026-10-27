/**
 * The hard floor under full access. Everything else runs without asking; these always ask,
 * because a mistake or an injected instruction here is either unrecoverable or leaks secrets.
 * Paths are absolute and already resolved (symlinks followed) by the caller.
 */

function norm(path: string): string {
  const unified = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return (unified || "/").toLowerCase();
}

function parent(path: string): string {
  const index = path.lastIndexOf("/");
  return index <= 0 ? "/" : path.slice(0, index);
}

function inside(path: string, root: string): boolean {
  return path === root || path.startsWith(root === "/" ? "/" : `${root}/`);
}

/** Deleting these loses a whole home, vault or system area; the trash does not make that safe. */
export function criticalDeletion(path: string, home: string, vaultRoot: string | null): string | null {
  const target = norm(path);
  const homeDir = norm(home);
  if (/^[a-z]:$/.test(target) || target === "/") return "磁盘根目录";
  if (target === homeDir || inside(homeDir, target)) return "用户主目录或其上级";
  if (vaultRoot && (target === norm(vaultRoot) || inside(norm(vaultRoot), target))) return "整个 Obsidian 仓库";
  if (parent(target) === homeDir) return "主目录下的顶层文件夹";
  if (parent(target) === "/" || /^\/(system|usr|bin|sbin|etc|library)(\/|$)/.test(target)) return "系统目录";
  return null;
}

const SECRET_DIRS = [
  ".ssh", ".aws", ".gnupg", ".kube", ".docker", ".azure", ".password-store", ".config/gh", ".config/gcloud",
  "library/keychains", "library/cookies", "library/messages", "library/mail", "library/safari",
  "library/application support/google/chrome", "library/application support/firefox", "library/application support/microsoft edge",
  "library/application support/bravesoftware", "library/application support/arc", "appdata/local/google/chrome", "appdata/roaming/mozilla",
];
const SECRET_FILE = /^(\.env(\.(?!example$|sample$|template$)[^/]+)?|\.netrc|\.npmrc|\.pypirc|\.git-credentials|\.zsh_history|\.bash_history|id_(rsa|ed25519|ecdsa|dsa)|.+\.(pem|p12|pfx|key|keystore|kdbx))$/;
const STARTUP_FILES = /^(\.zshrc|\.zprofile|\.zshenv|\.zlogin|\.bashrc|\.bash_profile|\.profile|\.gitconfig)$/;
const STARTUP_DIRS = ["library/launchagents", "library/launchdaemons"];

/** Credentials and private data: reading sends them to the model provider. */
export function secretPath(path: string, home: string): string | null {
  const target = norm(path);
  const homeDir = norm(home);
  const name = target.split("/").pop() ?? "";
  if (SECRET_DIRS.some((dir) => inside(target, `${homeDir}/${dir}`))) return "凭据或私人数据目录";
  if (SECRET_FILE.test(name)) return "可能包含密钥或凭据的文件";
  return null;
}

/** Writing these changes what runs at login or in every shell; a classic persistence target. */
export function startupPath(path: string, home: string): string | null {
  const target = norm(path);
  const homeDir = norm(home);
  if (parent(target) === homeDir && STARTUP_FILES.test(target.split("/").pop() ?? "")) return "登录或 Shell 启动配置";
  if (STARTUP_DIRS.some((dir) => inside(target, `${homeDir}/${dir}`) || inside(target, `/${dir}`))) return "开机自动运行项";
  if (inside(target, "/etc") || inside(target, "/private/etc")) return "系统配置";
  return null;
}

const SHELL_RULES: Array<[RegExp, string]> = [
  [/(^|[\s;&|(`])(sudo|su|doas)\s/, "需要管理员权限"],
  [/(^|[\s;&|(`])(rm|rmdir|unlink|shred|srm)\s|\s-delete\b|\bgit\s+clean\b/, "直接删除不会进废纸篓（请改用 delete_path）"],
  [/\b(mkfs|newfs|fdisk|diskutil\s+(erase|partition|zero|secureerase|apfs\s+delete)|format\s+[a-z]:)/i, "会格式化或改动磁盘"],
  [/\bdd\b[^|;&]*\bof=\/dev\//, "直接写入磁盘设备"],
  [/:\s*\(\s*\)\s*\{[^}]*:\s*\|\s*:/, "会耗尽系统资源"],
  [/\b(shutdown|reboot|halt|poweroff)\b/, "会关机或重启"],
  [/\b(curl|wget)\b[^|;&]*\|\s*(sudo\s+)?(sh|bash|zsh|fish|python3?|node|perl|ruby)\b/, "下载并直接执行远程脚本"],
  [/\bchmod\s+(-R|--recursive)\b|\bchown\s+(-R|--recursive)\b/, "递归修改权限或所有者"],
  [/\bgit\s+(reset\s+--hard|checkout\s+--\s|restore\s+\.|stash\s+(drop|clear))|\bgit\s+push\b[^;&|]*(\s-f\b|--force)/, "会丢弃未提交的改动或强推"],
  [/\bsecurity\s+(find-(generic|internet)-password|dump-keychain|export)\b/, "读取钥匙串密码"],
  [/(~|\$HOME|\/users\/[^/\s]+|\/home\/[^/\s]+)\/(\.ssh|\.aws|\.gnupg|\.kube|\.docker|library\/keychains|library\/cookies)\b|\bid_(rsa|ed25519|ecdsa)\b|\.git-credentials|\.netrc\b/i, "访问凭据或私人数据"],
  [/\b(crontab\s+(-r|-e|-)|launchctl\s+(load|bootstrap|submit))\b/, "修改自动运行任务"],
];

/** Why this command needs a person to look at it, or null to run it straight away. */
export function shellRisk(command: string): string | null {
  const text = command.replace(/\\\n/g, " ");
  for (const [pattern, reason] of SHELL_RULES) if (pattern.test(text)) return reason;
  return null;
}
