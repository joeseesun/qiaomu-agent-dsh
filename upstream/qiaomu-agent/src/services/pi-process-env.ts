type Environment = Record<string, string | undefined>;

/** 只为 Pi 子进程生成环境，不修改父进程或 Pi 全局设置。 */
export async function piProcessEnv(require: (id: string) => unknown, overrides?: Environment): Promise<Environment> {
  const runtime = require("process") as { platform: string; env: Environment };
  const env = { ...runtime.env, ...overrides };
  for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY"]) {
    if (!env[key] && env[key.toLowerCase()]) env[key] = env[key.toLowerCase()];
  }
  if (env.HTTP_PROXY || env.HTTPS_PROXY || env.ALL_PROXY || runtime.platform !== "darwin") return env;

  const output = await new Promise<string>((resolve) => {
    try {
      (require("child_process") as { execFile: (path: string, args: string[], options: object, callback: (error: Error | null, stdout: string) => void) => void })
        .execFile("/usr/sbin/scutil", ["--proxy"], { timeout: 2_000, maxBuffer: 64 * 1024, windowsHide: true },
          (error, stdout) => resolve(error ? "" : stdout));
    } catch { resolve(""); }
  });
  const value = (key: string): string => output.match(new RegExp(`^\\s*${key}\\s*:\\s*(.+)$`, "m"))?.[1]?.trim() ?? "";
  for (const [prefix, key] of [["HTTP", "HTTP_PROXY"], ["HTTPS", "HTTPS_PROXY"]] as const) {
    if (value(`${prefix}Enable`) !== "1") continue;
    const host = value(`${prefix}Proxy`);
    const port = value(`${prefix}Port`);
    if (!host || /[\s/@?#]/.test(host) || !/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) continue;
    env[key] = `http://${host.includes(":") && !host.startsWith("[") ? `[${host}]` : host}:${port}`;
  }
  if ((env.HTTP_PROXY || env.HTTPS_PROXY) && !env.NO_PROXY) {
    const exceptions = output.match(/ExceptionsList\s*:\s*<array>\s*\{([^}]*)\}/)?.[1];
    const hosts = exceptions?.split("\n").map((line) => line.match(/^\s*\d+\s*:\s*(.+)$/)?.[1]?.trim())
      .filter((host): host is string => Boolean(host && host !== "<local>"));
    if (hosts?.length) env.NO_PROXY = hosts.join(",");
  }
  return env;
}
