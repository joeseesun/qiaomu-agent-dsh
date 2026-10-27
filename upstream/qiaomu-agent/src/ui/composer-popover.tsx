import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/** Non-modal, leaf-local controls: no portal, focus trap, or hover-only actions. */
export function ComposerPopover({ label, trigger, iconOnly = false, disabled, className = "", children }: {
  label: string; trigger: ReactNode; iconOnly?: boolean; disabled?: boolean; className?: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = () => { setOpen(false); button.current?.focus(); };
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useEffect(() => {
    if (!open) return;
    const doc = root.current!.ownerDocument;
    panel.current?.querySelector<HTMLElement>("button, input, select")?.focus();
    const outside = (event: PointerEvent) => {
      if (!event.composedPath().includes(root.current!)) setOpen(false);
    };
    doc.addEventListener("pointerdown", outside);
    return () => doc.removeEventListener("pointerdown", outside);
  }, [open]);
  return <div ref={root} className={`qa-control ${className}`} onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }} onKeyDown={(event) => {
    if (open && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
  }}>
    <button ref={button} type="button" className="qa-control-trigger" aria-label={iconOnly ? label : undefined} data-tooltip-position={iconOnly ? "top" : undefined} aria-expanded={open}
      aria-haspopup="dialog" aria-controls={open ? id : undefined} disabled={disabled} onClick={() => setOpen(!open)}>{trigger}</button>
    {open && <div ref={panel} id={id} role="dialog" aria-labelledby={`${id}-label`} className="qa-control-popover"><span id={`${id}-label`} className="qiaomu-agent__sr-only">{label}</span>{children(close)}</div>}
  </div>;
}

export function effortLabel(value: string) {
  return ({ "": "默认", low: "低", medium: "中", high: "高", xhigh: "极高", minimal: "最小", none: "关闭", max: "最高", ultra: "超高" } as Record<string, string>)[value] ?? value;
}
