import type { ContextUsage } from "../types";
import { compactTokens } from "../services/model-capabilities";
import { ComposerPopover } from "./composer-popover";

/** From this share on, earlier turns may already be compacted or forgotten. */
export const CONTEXT_WARNING = 0.8;

/**
 * Context window occupancy, adapted from AI Elements `Context` (ring + detail, compact numbers).
 * Shown only for reported numbers; a click popover instead of a hover card so it works on touch.
 */
export function ContextRing({ usage, onNew, disabled }: { usage: ContextUsage; onNew: () => void; disabled?: boolean }) {
  const share = Math.min(usage.used / usage.size, 1);
  const percent = Math.round(share * 100);
  const warning = share >= CONTEXT_WARNING;
  const radius = 7;
  const circumference = 2 * Math.PI * radius;
  return <ComposerPopover className={`qa-context-control${warning ? " is-warning" : ""}`} label={`上下文已用 ${percent}%`} iconOnly
    trigger={<svg className="qa-context-ring" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <circle cx="9" cy="9" r={radius} className="qa-context-track" />
      <circle cx="9" cy="9" r={radius} className="qa-context-value" strokeDasharray={`${share * circumference} ${circumference}`} transform="rotate(-90 9 9)" />
    </svg>}>
    {(close) => <div className="qa-context-detail">
      <p><strong>上下文已用 {percent}%</strong></p>
      <p className="qa-context-numbers">{compactTokens(usage.used)} / {compactTokens(usage.size)} tokens</p>
      {warning && <>
        <p>对话较长，前面的内容可能被压缩或遗忘。换个话题时，新建对话效果更好。</p>
        <button type="button" disabled={disabled} onClick={() => { close(); onNew(); }}>新建对话</button>
      </>}
    </div>}
  </ComposerPopover>;
}
