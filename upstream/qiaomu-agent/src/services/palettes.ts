/** Shared palette identities with Qiaomu RSS; preferences remain independent. */
export const CHAT_THEMES = { auto: "跟随 Obsidian", light: "明亮", paper: "宣纸", sage: "竹青", mist: "雾蓝", dark: "深海", black: "墨黑" } as const;
export type ChatTheme = keyof typeof CHAT_THEMES;
export function normalizeChatTheme(value: unknown): ChatTheme {
  return typeof value === "string" && Object.hasOwn(CHAT_THEMES, value) ? value as ChatTheme : "auto";
}
export function applyChatTheme(element: HTMLElement, theme: ChatTheme): void {
  if (theme === "auto") delete element.dataset.qaTheme;
  else element.dataset.qaTheme = theme;
}
