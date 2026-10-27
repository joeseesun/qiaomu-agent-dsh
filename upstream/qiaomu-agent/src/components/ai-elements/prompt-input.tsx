// Adapted from Vercel AI Elements, Apache-2.0. See THIRD_PARTY_NOTICES.md.
// Host changes: text-only form; Vault context is handled by the host, not browser uploads.
import type { ChatStatus } from "ai";
import { ArrowUp, Square } from "lucide-react";
import { forwardRef, useState, type ComponentProps } from "react";

export const PromptInput = ({ className = "", ...props }: ComponentProps<"form">) => (
  <form className={`qa-prompt ${className}`} {...props} />
);
export const PromptInputHeader = (props: ComponentProps<"div">) => <div className="qa-prompt-header" {...props} />;
export const PromptInputFooter = (props: ComponentProps<"div">) => <div className="qa-prompt-footer" {...props} />;
export const PromptInputTools = (props: ComponentProps<"div">) => <div className="qa-prompt-tools" {...props} />;

export const PromptInputTextarea = forwardRef<HTMLTextAreaElement, ComponentProps<"textarea"> & { submitOnEnter?: boolean }>(function PromptInputTextarea({ onKeyDown, submitOnEnter = true, ...props }, ref) {
  const [composing, setComposing] = useState(false);
  return <textarea ref={ref} name="message" className="qa-prompt-textarea" rows={2}
    onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)}
    onKeyDown={(event) => {
      onKeyDown?.(event);
      if (!submitOnEnter || event.defaultPrevented || event.key !== "Enter" || event.shiftKey || composing || event.nativeEvent.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      const submit = event.currentTarget.form?.querySelector<HTMLButtonElement>('button[type="submit"]');
      if (submit && !submit.disabled) event.currentTarget.form?.requestSubmit();
    }} {...props} />;
});

export function PromptInputSubmit({ status, onStop, disabled, ...props }: ComponentProps<"button"> & { status: ChatStatus; onStop: () => void }) {
  const running = status === "submitted" || status === "streaming";
  return <button className="qa-submit" type={running ? "button" : "submit"} disabled={!running && disabled}
    onClick={running ? onStop : undefined} {...props}>
    {running ? <Square size={14} aria-hidden="true" /> : <ArrowUp size={17} aria-hidden="true" />}
    <span className="qiaomu-agent__sr-only">{running ? "停止" : "发送"}</span>
  </button>;
}
