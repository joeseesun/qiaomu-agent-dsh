import { sanitizeHTMLToDom } from "obsidian";
import { mount, PeleError, register, supports, type MountOptions } from "pele/core";
import flowchart from "pele/diagrams/flowchart";
import sequence from "pele/diagrams/sequence";
import mindmap from "pele/diagrams/mindmap";
import { MAX_MERMAID_SOURCE } from "./host-mermaid";

// Keep the first adoption bounded; all other types use Obsidian's renderer.
register(flowchart, sequence, mindmap);

export const PELE_LIMITS = { limit: MAX_MERMAID_SOURCE, maxEdges: 500, outputLimit: 1_000_000 } as const;
export const supportsPele = supports;
export const isDiagramLimit = (error: unknown): boolean => error instanceof PeleError && error.code === "limit";

/** Local SVG only: no navigation, remote images, user-supplied icons or render options. */
export function mountPeleDiagram(element: HTMLElement, source: string, callbacks: Pick<MountOptions, "onRender" | "onError">) {
  const win = element.ownerDocument.defaultView;
  const fontSize = () => Number.parseFloat(win?.getComputedStyle(element).fontSize ?? "") || 16;
  let size = fontSize();
  const options: MountOptions = {
    ...PELE_LIMITS, ...callbacks, links: false, images: false,
    zoom: { always: true, controls: false },
    sanitize: sanitizeHTMLToDom,
    fontSize: size,
  };
  const diagram = mount(element, source, options);
  const root = element.closest(".qiaomu-agent");
  const observer = new MutationObserver(() => {
    const nextSize = fontSize();
    if (nextSize !== size) {
      size = nextSize;
      diagram.update(source, { ...options, fontSize: size });
    } else diagram.refresh(); // CSS color changes do not rebuild the SVG.
  });
  if (root) observer.observe(root, { attributes: true, attributeFilter: ["data-qa-theme", "style"] });
  observer.observe(element.ownerDocument.body, { attributes: true, attributeFilter: ["class"] });
  return {
    zoom: diagram.zoom,
    destroy() { observer.disconnect(); diagram.destroy(); element.replaceChildren(); },
  };
}
