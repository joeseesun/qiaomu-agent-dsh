import { Platform } from "obsidian";

interface RuntimeRequireContainer {
  require?: (id: string) => unknown;
}

export function getRuntimeRequire(): ((id: string) => unknown) | null {
  if (!Platform.isDesktopApp || typeof window === "undefined") return null;
  const container = window as unknown as RuntimeRequireContainer;
  return typeof container.require === "function" ? container.require : null;
}
