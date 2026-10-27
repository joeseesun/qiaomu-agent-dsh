// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { Platform } from "obsidian";
import { getRuntimeRequire } from "../src/services/runtime-require";

afterEach(() => { Platform.isDesktopApp = true; Reflect.deleteProperty(window, "require"); });
it("never exposes Node on mobile even when a require-like global exists", () => {
  const require = vi.fn();
  Object.assign(window, { require });
  Platform.isDesktopApp = false;
  expect(getRuntimeRequire()).toBeNull();
  expect(require).not.toHaveBeenCalled();
  Platform.isDesktopApp = true;
  expect(getRuntimeRequire()).toBe(require);
});
