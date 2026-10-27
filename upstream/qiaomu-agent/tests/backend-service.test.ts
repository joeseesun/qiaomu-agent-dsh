import { afterEach, expect, it, vi } from "vitest";
import { Platform, type App } from "obsidian";
import { BackendService } from "../src/services/backend-service";
import { DEFAULT_SETTINGS } from "../src/defaults";
import type { CliDetection } from "../src/types";

vi.mock("../src/services/native-agent-backend", () => ({
  nativeTransportFor: () => "app-server",
  nativeTransportLabel: () => "App Server",
  NativeAgentBackend: class {
    id = "cli:codex";
    resetSession = vi.fn();
    shutdown = vi.fn(async () => {});
  },
}));
afterEach(() => { Platform.isDesktopApp = true; });
const detection = { id: "codex", label: "Codex", callable: true } as CliDetection;
function setup() {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.backendKind = "cli";
  settings.preferredCli = "codex";
  const service = new BackendService({ secretStorage: { getSecret: () => "" } } as unknown as App, () => settings);
  service.setDetections([detection]);
  return { service, settings };
}
it("mobile ignores synced CLI selections without rewriting desktop preferences", () => {
  Platform.isDesktopApp = false;
  const { service, settings } = setup();
  expect(service.resolve("cli:codex").id).toBe("api");
  expect(service.resolve("auto").id).toBe("api");
  expect(service.getDetections()).toEqual([]);
  expect(service.getBackendOptions().some((o) => o.value.startsWith("cli:"))).toBe(false);
  expect(settings.backendKind).toBe("cli");
  expect(settings.preferredCli).toBe("codex");
  expect(service.getBackendOptions().find((o) => o.value === "api")?.ready).toBe(false);
});
it("each view owns its backend, resets and close cannot affect another view", async () => {
  const { service } = setup();
  const a = service.resolve("cli:codex", "a");
  const b = service.resolve("cli:codex", "b");
  expect(a).not.toBe(b);
  expect(service.resolve("cli:codex", "a")).toBe(a);
  service.resetSessions("a");
  expect(a.resetSession).toHaveBeenCalledOnce();
  expect(b.resetSession).not.toHaveBeenCalled();
  await service.release("a");
  expect(a.shutdown).toHaveBeenCalledOnce();
  expect(b.shutdown).not.toHaveBeenCalled();
  expect(service.resolve("cli:codex", "a")).not.toBe(a);
  await service.shutdown();
  expect(b.shutdown).toHaveBeenCalledOnce();
});
