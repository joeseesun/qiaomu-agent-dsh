import { describe, expect, it } from "vitest";
import { normalizeSettings } from "../src/defaults";
import { applyChatTheme, CHAT_THEMES } from "../src/services/palettes";
describe("chat palettes", () => {
  it("migrates old or invalid settings without changing other preferences", () => {
    for (const chatTheme of [undefined, null, "unknown", "constructor", {}, 1]) {
      const settings = normalizeSettings({ chatTheme, chatFontSize: 18 });
      expect(settings.chatTheme).toBe("auto"); expect(settings.chatFontSize).toBe(18);
    }
  });
  it("round trips every palette and removes overrides when following the host", () => {
    const element = { dataset: {} } as HTMLElement;
    for (const chatTheme of Object.keys(CHAT_THEMES)) {
      const settings = normalizeSettings(JSON.parse(JSON.stringify({ chatTheme })));
      expect(settings.chatTheme).toBe(chatTheme);
      applyChatTheme(element, settings.chatTheme);
      expect(element.dataset.qaTheme).toBe(chatTheme === "auto" ? undefined : chatTheme);
    }
    applyChatTheme(element, "auto"); expect(element.dataset.qaTheme).toBeUndefined();
  });
});
