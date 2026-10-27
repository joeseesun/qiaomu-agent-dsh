// Adapted from Vercel AI Elements, Apache-2.0. See THIRD_PARTY_NOTICES.md.
// Host changes: scoped CSS, instant/reduced-motion scrolling, accessible Chinese action.
import { ArrowDown } from "lucide-react";
import type { ComponentProps } from "react";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";

export const Conversation = ({ className = "", ...props }: ComponentProps<typeof StickToBottom>) => (
  <StickToBottom className={`qa-conversation ${className}`} initial="instant" resize="instant" role="log" {...props} />
);
export const ConversationContent = ({ className = "", ...props }: ComponentProps<typeof StickToBottom.Content>) => (
  <StickToBottom.Content className={`qa-conversation-content ${className}`} {...props} />
);
export function ConversationScrollButton() {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();
  return !isAtBottom && <button className="qa-scroll-bottom" type="button" onClick={() => void scrollToBottom()}>
    <ArrowDown size={16} aria-hidden="true" /><span className="qiaomu-agent__sr-only">回到最新消息</span>
  </button>;
}
