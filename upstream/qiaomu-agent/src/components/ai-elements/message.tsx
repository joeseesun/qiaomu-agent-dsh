// Adapted from Vercel AI Elements, Apache-2.0. See THIRD_PARTY_NOTICES.md.
// Host changes: scoped CSS, no tooltip provider, Markdown rendered by Obsidian.
import type { ComponentProps, HTMLAttributes } from "react";
import type { UIMessage } from "ai";

export const Message = ({ className = "", from, ...props }: HTMLAttributes<HTMLDivElement> & { from: UIMessage["role"] }) => (
  <div className={`qa-message ${from === "user" ? "is-user" : "is-assistant"} ${className}`} {...props} />
);
export const MessageContent = ({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={`qa-message-content ${className}`} {...props} />
);
export const MessageActions = ({ className = "", ...props }: ComponentProps<"div">) => (
  <div className={`qa-message-actions ${className}`} {...props} />
);
export const MessageAction = ({ label, children, ...props }: ComponentProps<"button"> & { label: string }) => (
  <button type="button" aria-label={label} {...props}>{children}<span className="qiaomu-agent__sr-only">{label}</span></button>
);
