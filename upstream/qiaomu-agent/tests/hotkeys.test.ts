import { describe, expect, it } from "vitest";
import type { App } from "obsidian";
import { commandHotkey, formatHotkey } from "../src/services/hotkeys";

describe("hotkeys", () => {
  it("formats per platform", () => {
    expect(formatHotkey({ modifiers: ["Shift", "Mod"], key: "u" }, true)).toBe("⇧⌘U");
    expect(formatHotkey({ modifiers: ["Shift", "Mod"], key: "u" }, false)).toBe("Shift+Ctrl+U");
  });
  it("prefers the user's binding and tolerates a missing manager", () => {
    const app = { hotkeyManager: { getHotkeys: (id: string) => id === "p:c" ? [{ modifiers: ["Mod"], key: "U" }] : undefined, getDefaultHotkeys: () => [] } } as unknown as App;
    expect(commandHotkey(app, "p", "c", true)).toBe("⌘U");
    expect(commandHotkey(app, "p", "x", true)).toBe("");
    expect(commandHotkey({} as App, "p", "c", true)).toBe("");
  });
});
