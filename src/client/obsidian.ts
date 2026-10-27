/** Small host boundary used by the unchanged original Agent components. */
export * from "./original-ui";
import DOMPurify from "dompurify";
import { Marked } from "marked";
import { parse, stringify } from "yaml";
import { Component, ItemView, TAbstractFile, TFile, TFolder } from "./original-ui";
import { Control, createEl } from "./harness-ui";

export class App {}
export class WorkspaceLeaf {}
export class FileView extends ItemView { file: TFile | null = null; }
export class FileSystemAdapter {
  constructor(private readonly basePath: string) {}
  getBasePath() { return this.basePath; }
}
export class Vault {
  static recurseChildren(folder: TFolder, visit: (file: TAbstractFile) => void) {
    for (const child of folder.children) {
      visit(child);
      if (child instanceof TFolder) Vault.recurseChildren(child, visit);
    }
  }
}
export class ButtonComponent extends Control {
  constructor(parent: HTMLElement) {
    const el = createEl("button", { attr: { type: "button" } });
    parent.appendChild(el);
    super(el);
  }
}
export class ToggleComponent extends Control {
  constructor(parent: HTMLElement) {
    const el = createEl("input", { attr: { type: "checkbox", role: "switch" } });
    parent.appendChild(el);
    super(el);
  }
}
export const parseYaml = (source: string) => parse(source, { maxAliasCount: 20 });
export const stringifyYaml = stringify;

/** Keep SVG available for original Pele diagrams, with executable content removed. */
export function sanitizeHTMLToDom(html: string): DocumentFragment {
  if (!DOMPurify.isSupported) throw Error("This environment does not support safe HTML rendering");
  return DOMPurify.sanitize(html, { RETURN_DOM_FRAGMENT: true, USE_PROFILES: { html: true, svg: true, svgFilters: true } });
}
const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const markdown = new Marked({ gfm: true });
markdown.use({ extensions: [{
  name: "wikiLink", level: "inline",
  start: source => source.indexOf("[["),
  tokenizer(source) {
    const match = /^\[\[([^\]\n]+)\]\]/.exec(source);
    if (!match) return undefined;
    const [target = "", ...alias] = match[1]!.split("|");
    return { type: "wikiLink", raw: match[0], target, label: alias.join("|") || target };
  },
  renderer(token) {
    return `<a class="internal-link" href="${escape(String(token.target))}" data-href="${escape(String(token.target))}">${escape(String(token.label))}</a>`;
  },
}] });
interface MarkdownHost {
  metadataCache?: { getFirstLinkpathDest(link: string, source: string): TFile | null };
  vault?: { getResourcePath(file: TFile): string };
}
export class MarkdownRenderer {
  static async render(app: MarkdownHost, source: string, target: HTMLElement, sourcePath: string, component: Component): Promise<void> {
    let live = true;
    component.register(() => { live = false; });
    const html = await markdown.parse(source);
    if (!live) return;
    if (!DOMPurify.isSupported) throw Error("This environment does not support safe Markdown rendering");
    const fragment = DOMPurify.sanitize(html, { RETURN_DOM_FRAGMENT: true, USE_PROFILES: { html: true } });
    for (const anchor of fragment.querySelectorAll("a")) {
      anchor.setAttribute("rel", "noopener noreferrer");
      if (/^https?:/i.test(anchor.getAttribute("href") || "")) anchor.setAttribute("target", "_blank");
    }
    for (const image of fragment.querySelectorAll("img")) {
      const src = image.getAttribute("src") || "";
      if (!src || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(src)) continue;
      const file = app.metadataCache?.getFirstLinkpathDest(src, sourcePath);
      if (file && app.vault) image.src = app.vault.getResourcePath(file);
    }
    if (live) target.replaceChildren(fragment);
  }
}

let mermaid: Promise<typeof import("mermaid")["default"]> | undefined;
/** Host-independent fallback for diagram types outside the original Pele subset. */
export function loadMermaid() {
  return mermaid ??= import("mermaid").then(module => {
    module.default.initialize({ startOnLoad: false, securityLevel: "strict", maxTextSize: 20_000, suppressErrorRendering: true });
    return module.default;
  }).catch(error => { mermaid = undefined; throw error; });
}
