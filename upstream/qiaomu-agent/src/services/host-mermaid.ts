import { loadMermaid } from "obsidian";

/**
 * Renders Mermaid with the copy Obsidian already ships (bundling our own cost ~3.5 MB).
 * The result is only ever shown as an inert image, so diagram scripts and links cannot run.
 * The theme is set per diagram with an init directive; Obsidian's global config is untouched.
 */

export const MAX_MERMAID_SOURCE = 20_000;

let queue: Promise<unknown> = Promise.resolve();

interface HostMermaid { render(id: string, text: string): Promise<{ svg: string }>; }

export function withTheme(source: string, theme: "default" | "dark" | "neutral"): string {
  return /^\s*%%\{\s*init/.test(source) ? source : `%%{init: {"theme": "${theme}"}}%%\n${source}`;
}

export function renderMermaidSvg(source: string, theme: "default" | "dark" | "neutral"): Promise<string> {
  if (source.length > MAX_MERMAID_SOURCE) return Promise.reject(new Error("Mermaid 图表过大"));
  // Mermaid keeps global render state, so diagrams render one at a time.
  const task = queue.catch(() => undefined).then(async () => {
    const mermaid = await loadMermaid() as HostMermaid;
    const id = `qa-mermaid-${crypto.randomUUID()}`;
    try {
      const { svg } = await mermaid.render(id, withTheme(source, theme));
      if (!svg || /class="error-icon"/.test(svg)) throw new Error("Mermaid 语法无法解析");
      return svg;
    } finally {
      // Mermaid leaves its scratch container behind when parsing fails.
      for (const leftover of [document.getElementById(id), document.getElementById(`d${id}`)]) leftover?.remove();
    }
  });
  queue = task;
  return task;
}

/** Gives an SVG explicit pixel dimensions from its viewBox so it displays and rasterizes at natural size. */
export function sizeSvg(svgText: string): { svg: string; width: number; height: number } {
  const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const svg = doc.documentElement;
  const box = (svg.getAttribute("viewBox") ?? "").split(/[\s,]+/).map(Number);
  const maxWidth = Number.parseFloat(/max-width:\s*([\d.]+)px/.exec(svg.getAttribute("style") ?? "")?.[1] ?? "");
  let width = box.length === 4 && box[2]! > 0 ? box[2]! : Number.parseFloat(svg.getAttribute("width") ?? "") || 600;
  let height = box.length === 4 && box[3]! > 0 ? box[3]! : Number.parseFloat(svg.getAttribute("height") ?? "") || 400;
  if (Number.isFinite(maxWidth) && maxWidth > 0 && maxWidth < width) { height = height * maxWidth / width; width = maxWidth; }
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.removeAttribute("style");
  return { svg: new XMLSerializer().serializeToString(svg), width, height };
}

export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
