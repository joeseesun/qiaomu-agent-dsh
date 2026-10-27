import { expect, it } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { getCliProcesses } from "../src/services/cli-process";

// Local macOS/Linux runs skip this test; the dedicated Windows CI job executes it.
it.skipIf(process.platform !== "win32")("runs an npm cmd shim with literal argv through execFile and spawn on Windows", async () => {
  const directory = mkdtempSync(join(tmpdir(), "qiaomu CLI %literal% !literal! & "));
  try {
    const entry = join(directory, "node_modules", "fixture", "cli.js");
    mkdirSync(dirname(entry), { recursive: true });
    writeFileSync(entry, "process.stdout.write(JSON.stringify(process.argv.slice(2)))");
    const wrapper = join(directory, "fixture.cmd");
    writeFileSync(wrapper, '@ECHO off\r\nSET "_prog=node"\r\n"%_prog%" "%~dp0\\node_modules\\fixture\\cli.js" %*\r\n');
    const marker = join(directory, "injected.txt");
    const args = ["", "with spaces", 'a "quote"', "trailing\\", "%PATH%", "!PATH!", "^ (parentheses)", "a\nb", `& echo unsafe > "${marker}"`];
    const env = { ...process.env };
    const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
    env[pathKey] = `${dirname(process.execPath)};${env[pathKey] ?? ""}`;
    const child = getCliProcesses(createRequire(import.meta.url)) as typeof import("node:child_process");
    const output = await new Promise<string>((resolve, reject) => child.execFile(wrapper, args, {
      env, cwd: directory, windowsHide: true, timeout: 5000, maxBuffer: 65536, encoding: "utf8",
    }, (error, stdout) => error ? reject(error) : resolve(stdout)));
    expect(JSON.parse(output)).toEqual(args);
    const spawned = await new Promise<string>((resolve, reject) => {
      const handle = child.spawn(wrapper, args, { env, cwd: directory, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
      let stdout = ""; let stderr = "";
      handle.stdout.on("data", (chunk) => { stdout += String(chunk); });
      handle.stderr.on("data", (chunk) => { stderr += String(chunk); });
      handle.on("error", reject);
      handle.on("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr || `exit ${code}`)));
    });
    expect(JSON.parse(spawned)).toEqual(args);
    expect(existsSync(marker)).toBe(false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 15_000);
