import type { App } from "obsidian";

/** Composer add actions that also exist as commands, so users can bind hotkeys to them. */
export type AddKind = "upload" | "file" | "folder";
export const ADD_COMMANDS: Record<AddKind, { id: string; name: string }> = {
  upload: { id: "attach-upload", name: "附加文件或图片" },
  file: { id: "attach-vault-file", name: "附加库内文件" },
  folder: { id: "attach-vault-folder", name: "附加库内文件夹" },
};

interface Hotkey { modifiers: string[]; key: string }
type HotkeyManager = { getHotkeys?(id: string): Hotkey[] | undefined; getDefaultHotkeys?(id: string): Hotkey[] | undefined };

export function formatHotkey(hotkey: Hotkey, mac: boolean): string {
  const names: Record<string, string> = mac ? { Mod: "⌘", Meta: "⌘", Ctrl: "⌃", Alt: "⌥", Shift: "⇧" } : { Mod: "Ctrl", Meta: "Win", Ctrl: "Ctrl", Alt: "Alt", Shift: "Shift" };
  const order = ["Ctrl", "Alt", "Shift", "Mod", "Meta"];
  const mods = [...hotkey.modifiers].sort((a, b) => order.indexOf(a) - order.indexOf(b)).map((m) => names[m] ?? m);
  const key = hotkey.key.length === 1 ? hotkey.key.toUpperCase() : hotkey.key;
  return mac ? [...mods, key].join("") : [...mods, key].join("+");
}

/** The first hotkey bound to a plugin command, read from Obsidian's (unofficial) hotkey manager; empty when unbound or unavailable. */
export function commandHotkey(app: App, pluginId: string, commandId: string, mac: boolean): string {
  try {
    const manager = (app as unknown as { hotkeyManager?: HotkeyManager }).hotkeyManager;
    const id = `${pluginId}:${commandId}`;
    const hotkey = manager?.getHotkeys?.(id)?.[0] ?? manager?.getDefaultHotkeys?.(id)?.[0];
    return hotkey ? formatHotkey(hotkey, mac) : "";
  } catch { return ""; }
}
