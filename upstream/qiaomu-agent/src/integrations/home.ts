import type QiaomuAgentPlugin from "../main";
import type { ConversationIdentity } from "../types";
import { homeProvider, type HomeItem, type HomeProvider } from "./qiaomu-home";

const MAX_ITEMS = 4;

function relative(ms: number): string {
  const minutes = Math.max(0, Math.round((Date.now() - ms) / 60_000));
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} 小时前`;
  return `${Math.round(minutes / 1440)} 天前`;
}

/** The active conversation (when it has content) followed by archived ones, newest first. */
function conversations(plugin: QiaomuAgentPlugin): ConversationIdentity[] {
  const settings = plugin.settings;
  const active = settings.activeConversation;
  const archived = settings.conversations ?? [];
  const list: ConversationIdentity[] = active?.title && settings.lastConversation?.length ? [active] : [];
  return [...list, ...archived.filter((item) => item.id !== active?.id && item.title)];
}

function item(plugin: QiaomuAgentPlugin, conversation: ConversationIdentity): HomeItem {
  return {
    id: conversation.id,
    title: conversation.title,
    meta: relative(conversation.createdAt),
    icon: conversation.fork ? "git-branch" : "message-square",
    open: async () => {
      await plugin.activateView();
      plugin.firstView()?.showConversationById(conversation.id);
    },
  };
}

/** What Qiaomu Agent shows on Qiaomu Home: recent conversations to resume, and a new-conversation action. */
export function createHomeProvider(plugin: QiaomuAgentPlugin): HomeProvider {
  return homeProvider({
    sections() {
      return [{
        id: "recent-conversations",
        title: "最近对话",
        items: conversations(plugin).slice(0, MAX_ITEMS).map((conversation) => item(plugin, conversation)),
        empty: "在主页搜索框输入问题，按 ⌘↵ 直接问 Agent",
        more: { id: "open", label: "打开", icon: "arrow-up-right", run: () => plugin.activateView(undefined, true) },
      }];
    },
    actions() {
      return [{
        id: "new-conversation",
        label: "新对话",
        icon: "message-square-plus",
        run: async () => {
          await plugin.activateView();
          const view = plugin.firstView();
          view?.newConversation();
          view?.focusComposer();
        },
      }];
    },
    search(query, limit) {
      const q = query.toLowerCase();
      return conversations(plugin).filter((conversation) => conversation.title.toLowerCase().includes(q)).slice(0, limit).map((conversation) => item(plugin, conversation));
    },
  });
}
