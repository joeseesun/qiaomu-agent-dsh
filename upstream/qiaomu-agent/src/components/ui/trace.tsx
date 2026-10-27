/*!
MIT License

Copyright (c) 2023 shadcn

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
// Host adaptation: scoped CSS and native details/summary instead of Base UI/Tailwind.
import type { ComponentProps } from "react";
import { ChevronRight } from "lucide-react";

export function Trace({ className = "", ...props }: ComponentProps<"div">) {
  return <div data-slot="trace" className={`qa-trace ${className}`} {...props} />;
}
export function TraceLine({ className = "", status, ...props }: ComponentProps<"span"> & { status?: "running" | "error" | "pending" }) {
  return <span data-slot="trace-line" data-status={status} className={`qa-trace-line ${className}`} {...props} />;
}
export function TraceIcon(props: ComponentProps<"span">) {
  return <span data-slot="trace-icon" aria-hidden="true" {...props} />;
}
export function TraceTitle(props: ComponentProps<"span">) {
  return <span data-slot="trace-title" {...props} />;
}
export function TraceDescription(props: ComponentProps<"span">) {
  return <span data-slot="trace-description" {...props} />;
}
// Native disclosure keeps user expansion across streaming updates and supports keyboard activation.
export function TraceCollapsible(props: ComponentProps<"details">) {
  return <details data-slot="trace-collapsible" {...props} />;
}
export function TraceCollapsibleTrigger({ children, ...props }: ComponentProps<"summary">) {
  return <summary data-slot="trace-collapsible-trigger" {...props}>{children}<ChevronRight className="qa-chevron" size={14} aria-hidden="true" /></summary>;
}
export function TraceCollapsibleContent(props: ComponentProps<"div">) {
  return <div data-slot="trace-collapsible-content" {...props} />;
}
