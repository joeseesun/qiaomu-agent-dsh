import { Platform, type App } from "obsidian";
import type { ChatBackend, CliDetection, QiaomuSettings } from "../types";
import { ApiBackend } from "./api-backend";
import { CliBackend } from "./cli-backend";
import { ZcodeBackend } from "./zcode-backend";
import { PiRpcBackend } from "./pi-rpc-backend";
import { NativeAgentBackend, nativeTransportFor, nativeTransportLabel } from "./native-agent-backend";
import { WEB_SEARCH_SECRET_ID } from "./web-search";

export class BackendService {
  private detections: CliDetection[] = [];
  private readonly nativeBackends = new Map<string, NativeAgentBackend | ZcodeBackend | PiRpcBackend>();

  constructor(
    private readonly app: App,
    private readonly getSettings: () => QiaomuSettings
  ) {}

  setDetections(detections: CliDetection[]): void {
    this.detections = Platform.isDesktopApp ? detections : [];
  }

  getDetections(): CliDetection[] {
    return [...this.detections];
  }

  getBackendOptions(): Array<{ value: string; label: string; ready: boolean }> {
    const local = this.detections
      .filter((detection) => detection.callable)
      .map((detection) => ({
        value: `cli:${detection.id}`,
        label: detection.id === "pi" ? "Pi · RPC" : detection.id === "zcode" && detection.nativePath ? "ZCode · App Server" : nativeTransportLabel(detection.id, detection.nativePath)
          ? `${detection.label} · ${nativeTransportLabel(detection.id, detection.nativePath)}`
          : detection.label,
        ready: true,
      }));
    return [
      { value: "auto", label: "自动", ready: local.length > 0 || this.hasApiKey() },
      ...local,
      { value: "api", label: this.getSettings().api.model || "模型 API", ready: this.hasApiKey() },
    ];
  }

  effectiveSelection(selected: string): string {
    // Do not rewrite synced desktop preferences when opening the same vault on a phone.
    return !Platform.isDesktopApp ? "api" : selected;
  }

  resolve(selected: string, owner = "default"): ChatBackend {
    selected = this.effectiveSelection(selected);
    const settings = this.getSettings();
    if (selected.startsWith("cli:")) {
      const id = selected.slice(4);
      const detection = this.detections.find((item) => item.id === id && item.callable);
      if (!detection) throw new Error("所选本地 Agent 当前不可用，请重新检测");
      return this.localBackend(detection, owner);
    }
    if (selected === "api") return this.apiBackend();

    const preferred = settings.preferredCli
      ? this.detections.find((item) => item.id === settings.preferredCli && item.callable)
      : undefined;
    const first = preferred ?? this.detections.find((item) => item.callable);
    if (first) return this.localBackend(first, owner);
    return this.apiBackend();
  }

  resetSessions(owner = "default"): void {
    for (const [key, backend] of this.nativeBackends) {
      if (JSON.parse(key)[0] === owner) backend.resetSession();
    }
  }

  /** Restart idle Codex App Server processes so a newly installed MCP server is loaded. */
  async refreshCodexMcp(): Promise<boolean> {
    const entries = [...this.nativeBackends].filter(([key]) => JSON.parse(key)[1] === "codex") as Array<[string, NativeAgentBackend]>;
    if (entries.some(([, backend]) => backend.isBusy())) return false;
    for (const [key] of entries) this.nativeBackends.delete(key);
    await Promise.all(entries.map(([, backend]) => backend.shutdown()));
    return true;
  }

  async release(owner: string): Promise<void> {
    const owned = [...this.nativeBackends].filter(([key]) => JSON.parse(key)[0] === owner);
    for (const [key] of owned) this.nativeBackends.delete(key);
    await Promise.all(owned.map(([, backend]) => backend.shutdown()));
  }

  async shutdown(): Promise<void> {
    await Promise.all([...this.nativeBackends.values()].map((backend) => backend.shutdown()));
    this.nativeBackends.clear();
  }

  private localBackend(detection: CliDetection, owner: string): ChatBackend {
    if (detection.id === "pi") {
      const key = JSON.stringify([owner, detection.id]);
      let backend = this.nativeBackends.get(key);
      if (!backend) { backend = new PiRpcBackend(detection); this.nativeBackends.set(key, backend); }
      return backend;
    }
    if (detection.id === "zcode") {
      const key = JSON.stringify([owner, detection.id]);
      let backend = this.nativeBackends.get(key);
      if (!backend) { backend = new ZcodeBackend(detection); this.nativeBackends.set(key, backend); }
      return backend;
    }
    if (!nativeTransportFor(detection.id, detection.nativePath)) return new CliBackend(detection);
    const key = JSON.stringify([owner, detection.id]);
    let backend = this.nativeBackends.get(key);
    if (!backend) {
      backend = new NativeAgentBackend(detection);
      this.nativeBackends.set(key, backend);
    }
    return backend;
  }

  private apiBackend(): ApiBackend {
    const settings = this.getSettings();
    const key = this.app.secretStorage.getSecret(settings.api.secretId) ?? "";
    return new ApiBackend(settings.api, key, this.app.secretStorage.getSecret(WEB_SEARCH_SECRET_ID) ?? "", this.app);
  }

  private hasApiKey(): boolean {
    return Boolean(this.app.secretStorage.getSecret(this.getSettings().api.secretId)) || permitsEmptyKey(this.getSettings().api);
  }
}
import { permitsEmptyKey } from "./api-providers";
