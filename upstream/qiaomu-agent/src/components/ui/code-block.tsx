/*! Adapted from shadcn/ui (c) 2023 shadcn, MIT. See licenses/shadcn-ui-LICENSE and THIRD_PARTY_NOTICES.md. */
// Host adaptation: scoped styles, plain text, Chinese actions and visible clipboard failures.
import { useEffect, useId, useRef, useState, type ComponentProps } from "react";
import { Check, Copy, WrapText } from "lucide-react";

export function CodeBlock({ className = "", ...props }: ComponentProps<"div">) {
  return <div data-slot="code-block" className={`qa-code-block ${className}`} {...props} />;
}
export function CodeBlockHeader(props: ComponentProps<"div">) {
  return <div data-slot="code-block-header" {...props} />;
}
export function CodeBlockContent({ children, wrap = false, ...props }: ComponentProps<"pre"> & { wrap?: boolean }) {
  return <pre data-slot="code-block-content" data-wrap={wrap || undefined} dir="ltr" tabIndex={0} {...props}><code>{children}</code></pre>;
}

export function ToolOutput({ value, label = "输出" }: { value: string; label?: string }) {
  const labelId = useId();
  const [wrap, setWrap] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copying" | "copied" | "failed">("idle");
  const generation = useRef(0);
  const copying = useRef(false);
  useEffect(() => {
    generation.current++;
    copying.current = false;
    setCopyState("idle");
    return () => { generation.current++; };
  }, [value]);
  useEffect(() => {
    if (copyState !== "copied") return;
    const timeout = window.setTimeout(() => setCopyState("idle"), 2000);
    return () => window.clearTimeout(timeout);
  }, [copyState]);
  const copy = async (clipboard: Clipboard | undefined) => {
    if (copying.current) return;
    copying.current = true;
    const current = generation.current;
    setCopyState("copying");
    try {
      if (!clipboard) throw new Error("Clipboard unavailable");
      await clipboard.writeText(value);
      if (current === generation.current) setCopyState("copied");
    } catch {
      if (current === generation.current) setCopyState("failed");
    } finally {
      if (current === generation.current) copying.current = false;
    }
  };
  const copyLabel = copyState === "copied" ? "已复制输出" : copyState === "failed" ? "重试复制输出" : "复制输出";
  return <CodeBlock>
    <CodeBlockHeader>
      <span id={labelId} data-slot="code-block-title">{label}</span>
      <div data-slot="code-block-actions">
        <button type="button" className="clickable-icon" aria-label="自动换行" aria-pressed={wrap} onClick={() => setWrap(!wrap)}><WrapText size={14} aria-hidden="true" /></button>
        <button type="button" className="clickable-icon" aria-label={copyLabel} disabled={copyState === "copying"} onClick={(event) => { void copy(event.currentTarget.ownerDocument.defaultView?.navigator.clipboard); }}>{copyState === "copied" ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}</button>
      </div>
    </CodeBlockHeader>
    <CodeBlockContent wrap={wrap} aria-labelledby={labelId}>{value}</CodeBlockContent>
    {copyState === "failed" && <p className="qa-code-error" role="alert">复制失败，请重试或选中文字复制。</p>}
    {copyState === "copied" && <span className="qiaomu-agent__sr-only" role="status">已复制输出</span>}
  </CodeBlock>;
}
