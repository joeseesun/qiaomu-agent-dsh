import { beforeEach, expect, it, vi } from "vitest";
import { piProcessEnv } from "../src/services/pi-process-env";

const runtime = { platform: "darwin", env: {} as Record<string, string | undefined> };
const execFile = vi.fn();
const require = (name: string): unknown => name === "process" ? runtime : { execFile };
const systemProxy = (port: number) => `<dictionary> {
  HTTPEnable : 1
  HTTPProxy : proxy.example
  HTTPPort : ${port}
  HTTPSEnable : 1
  HTTPSProxy : proxy.example
  HTTPSPort : ${port}
  ExceptionsList : <array> {
    0 : localhost
    1 : *.local
  }
}`;

beforeEach(() => {
  runtime.platform = "darwin";
  runtime.env = { CUSTOM: "保留" };
  execFile.mockReset();
  execFile.mockImplementation((_path, _args, _options, callback) => callback(null, systemProxy(8421)));
});

it("读取当前系统代理，只生成 Pi 子进程环境，不修改父进程", async () => {
  expect(await piProcessEnv(require)).toMatchObject({ HTTP_PROXY: "http://proxy.example:8421", HTTPS_PROXY: "http://proxy.example:8421", NO_PROXY: "localhost,*.local", CUSTOM: "保留" });
  expect(runtime.env).toEqual({ CUSTOM: "保留" });
  expect(execFile).toHaveBeenCalledWith("/usr/sbin/scutil", ["--proxy"], expect.any(Object), expect.any(Function));
});

it.each([
  { HTTPS_PROXY: "http://custom.example:9443" },
  { https_proxy: "http://custom.example:9443" },
  { ALL_PROXY: "socks5://custom.example:1081" },
])("沿用用户的显式代理环境变量 %j", async (proxy) => {
  runtime.env = { ...runtime.env, ...proxy };
  const env = await piProcessEnv(require);
  expect(env).toMatchObject(proxy);
  if ("https_proxy" in proxy && proxy.https_proxy) expect(env.HTTPS_PROXY).toBe(proxy.https_proxy);
  expect(execFile).not.toHaveBeenCalled();
});

it("下一次连接重新读取系统代理端口", async () => {
  expect((await piProcessEnv(require)).HTTPS_PROXY).toBe("http://proxy.example:8421");
  execFile.mockImplementation((_path, _args, _options, callback) => callback(null, systemProxy(9032)));
  expect((await piProcessEnv(require)).HTTPS_PROXY).toBe("http://proxy.example:9032");
});

it("系统没有启用代理时沿用原环境直连", async () => {
  execFile.mockImplementation((_path, _args, _options, callback) => callback(null, "<dictionary> {\n  HTTPSEnable : 0\n}"));
  expect(await piProcessEnv(require)).toEqual(runtime.env);
});

it("系统检测失败时沿用原环境", async () => {
  execFile.mockImplementation((_path, _args, _options, callback) => callback(new Error("检测失败"), ""));
  expect(await piProcessEnv(require)).toEqual(runtime.env);
});

it("保留用户的代理例外列表", async () => {
  runtime.env.no_proxy = "custom.example";
  expect((await piProcessEnv(require)).NO_PROXY).toBe("custom.example");
});

it.each(["0", "65536", "错误端口"])("忽略无效系统代理端口 %s", async (port) => {
  execFile.mockImplementation((_path, _args, _options, callback) => callback(null, systemProxy(8421).replaceAll("8421", port)));
  expect(await piProcessEnv(require)).toEqual(runtime.env);
});

it("其他系统不调用 macOS 代理检测", async () => {
  runtime.platform = "linux";
  expect(await piProcessEnv(require)).toEqual(runtime.env);
  expect(execFile).not.toHaveBeenCalled();
});
