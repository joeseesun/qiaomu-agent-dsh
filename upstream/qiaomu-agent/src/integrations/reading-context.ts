import { Component, FileView, type App, type WorkspaceLeaf } from "obsidian";
import {
  CONTEXT_CHANGED_EVENT, MAX_CONTEXT_TEXT, MAX_SELECTION_TEXT, clipText, findContextProviders,
  type ContextSelection, type ContextSnapshot,
} from "./qiaomu-context";

/** Views the agent already understands (notes) or that never hold reading material. */
const IGNORED_VIEWS = new Set(["markdown", "empty", "file-explorer", "search", "bookmarks", "tag", "outline", "backlink", "outgoing-link", "graph", "localgraph", "all-properties", "release-notes"]);

interface CachedSelection { leaf: WorkspaceLeaf; selection: ContextSelection }

/**
 * Tracks the most recent reading leaf and answers "what is the user looking at": context a source
 * plugin handed over explicitly, then compatible providers, then built-in adapters for core PDF,
 * web viewer and a selection in any other plugin's view.
 */
export class ReadingContextService extends Component {
  private leaf: WorkspaceLeaf | null = null;
  private pinned: ContextSnapshot | null = null;
  private selection: CachedSelection | null = null;
  private dismissed = "";
  private timer = 0;

  constructor(
    private readonly app: App,
    private readonly agentViewType: string,
    private readonly onChange: () => void,
    private readonly adapters: readonly ContextAdapter[] = BUILTIN_ADAPTERS,
  ) { super(); }

  override onload(): void {
    this.track(this.app.workspace.getMostRecentLeaf());
    this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf) => { if (this.track(leaf)) this.changed(); }));
    this.registerEvent(this.app.workspace.on("layout-change", () => {
      if (this.leaf && !this.leaf.view.containerEl.isConnected) { this.leaf = null; this.selection = null; this.pinned = null; }
      this.changed();
    }));
    // Custom workspace events are untyped in the public API.
    const on = this.app.workspace.on.bind(this.app.workspace) as (name: string, callback: (...data: unknown[]) => unknown) => ReturnType<typeof this.app.workspace.on>;
    this.registerEvent(on(CONTEXT_CHANGED_EVENT, () => this.changed()));
    this.registerDomEvent(document, "selectionchange", () => {
      window.clearTimeout(this.timer);
      this.timer = window.setTimeout(() => this.captureSelection(document), 150);
    });
  }

  override onunload(): void { window.clearTimeout(this.timer); }

  /** Context handed over by a source's "Ask AI" action; it wins until sent or dismissed. */
  pin(snapshot: ContextSnapshot): void {
    this.pinned = sanitize(snapshot);
    this.dismissed = "";
    this.changed();
  }

  current(): ContextSnapshot | null {
    const snapshot = this.pinned ?? this.live();
    return snapshot && snapshotKey(snapshot) !== this.dismissed ? snapshot : null;
  }

  /** Removes the shown context until the reading position or selection changes. */
  dismiss(): void {
    const snapshot = this.current();
    this.pinned = null;
    if (snapshot) this.dismissed = snapshotKey(snapshot);
    this.changed();
  }

  /** Called after a message carried the context: an explicit hand-over is used once. */
  consumed(): void {
    if (!this.pinned) return;
    this.pinned = null;
    this.changed();
  }

  private live(): ContextSnapshot | null {
    const leaf = this.leaf;
    if (!leaf || !this.attached(leaf)) return null;
    const cached = this.selection?.leaf === leaf ? this.selection.selection : undefined;
    for (const [id, provider] of findContextProviders(this.app)) {
      let snapshot: ContextSnapshot | null = null;
      try { snapshot = provider.snapshot(leaf); } catch (error) { console.warn(`Qiaomu Agent: context provider ${id} failed`, error); }
      if (snapshot) return sanitize({ ...snapshot, sourceId: snapshot.sourceId || id, selection: snapshot.selection ?? cached });
    }
    return builtinSnapshot(leaf, cached, this.adapters);
  }

  /**
   * Remembers a reading leaf. Notes, sidebars and the agent never replace it, so reading in one pane
   * while writing in another keeps the article; it stops counting once it is no longer on screen.
   */
  private track(leaf: WorkspaceLeaf | null): boolean {
    if (!leaf || leaf === this.leaf) return false;
    const type = leaf.view.getViewType();
    if (type === this.agentViewType || IGNORED_VIEWS.has(type)) return false;
    const root = leaf.getRoot();
    if (root === this.app.workspace.leftSplit || root === this.app.workspace.rightSplit) return false;
    this.leaf = leaf;
    this.selection = null;
    this.pinned = null;
    return true;
  }

  /** Attached and visible: a leaf in a background tab or a closed pane is not being read. */
  private attached(leaf: WorkspaceLeaf): boolean {
    const element = leaf.view.containerEl as HTMLElement & { isShown?: () => boolean };
    return element.isConnected && (element.isShown?.() ?? true);
  }

  /**
   * DOM selections vanish when focus moves to the agent, so keep the last one made inside the reading
   * leaf. A collapsed selection clears it only while the reading leaf still has focus.
   */
  private captureSelection(doc: Document): void {
    const leaf = this.leaf;
    if (!leaf) return;
    const container = leaf.view.containerEl;
    const range = doc.getSelection();
    const inside = (node: Node | null | undefined) => Boolean(node && container.contains(node));
    if (range && !range.isCollapsed && inside(range.anchorNode) && inside(range.focusNode)) {
      const text = range.toString().trim();
      if (!text) return;
      const next = { text: clipText(text, MAX_SELECTION_TEXT).text, location: pageOf(range.anchorNode) };
      if (this.selection?.leaf === leaf && this.selection.selection.text === next.text) return;
      this.selection = { leaf, selection: next };
      this.changed();
    } else if (this.selection && inside(doc.activeElement)) {
      this.selection = null;
      this.changed();
    }
  }

  private changed(): void { this.onChange(); }
}

/**
 * Reads context from views whose plugins do not speak the protocol. Add one to support another view
 * type (Canvas, Bases, Excalidraw…); adapters run in order and the first non-null result wins.
 */
export interface ContextAdapter {
  id: string;
  snapshot(leaf: WorkspaceLeaf, selection?: ContextSelection): ContextSnapshot | null;
}

export const pdfAdapter: ContextAdapter = {
  id: "pdf",
  snapshot(leaf, selection) {
    const view = leaf.view;
    if (view.getViewType() !== "pdf" || !(view instanceof FileView) || !view.file) return null;
    return { sourceId: "pdf", sourceName: "PDF", kind: "document", title: view.file.basename, path: view.file.path, location: selection?.location, selection };
  },
};

export const webViewerAdapter: ContextAdapter = {
  id: "webviewer",
  snapshot(leaf, selection) {
    if (leaf.view.getViewType() !== "webviewer") return null;
    const state = leaf.getViewState().state as { url?: unknown } | undefined;
    const url = typeof state?.url === "string" && /^https?:\/\//.test(state.url) ? state.url : undefined;
    return { sourceId: "webviewer", sourceName: "网页", kind: "page", title: leaf.view.getDisplayText(), url, selection };
  },
};

/** Any other plugin's view: only an explicit selection is meaningful there. */
export const selectionAdapter: ContextAdapter = {
  id: "selection",
  snapshot(leaf, selection) {
    if (!selection) return null;
    const view = leaf.view;
    const file = view instanceof FileView ? view.file : null;
    return { sourceId: view.getViewType(), sourceName: view.getDisplayText(), kind: "other", title: file?.basename ?? view.getDisplayText(), path: file?.path, selection };
  },
};

export const BUILTIN_ADAPTERS: readonly ContextAdapter[] = [pdfAdapter, webViewerAdapter, selectionAdapter];

export function builtinSnapshot(leaf: WorkspaceLeaf, selection?: ContextSelection, adapters: readonly ContextAdapter[] = BUILTIN_ADAPTERS): ContextSnapshot | null {
  if (IGNORED_VIEWS.has(leaf.view.getViewType())) return null;
  for (const adapter of adapters) {
    const snapshot = adapter.snapshot(leaf, selection);
    if (snapshot) return snapshot;
  }
  return null;
}

/** Page number of a PDF.js text layer node, e.g. "p. 12". */
function pageOf(node: Node | null): string | undefined {
  const element = node instanceof Element ? node : node?.parentElement;
  const page = element?.closest<HTMLElement>("[data-page-number]")?.dataset.pageNumber;
  return page ? `p. ${page}` : undefined;
}

/** Normalizes a snapshot from another plugin: strings only, bounded sizes, http(s) links only. */
export function sanitize(input: ContextSnapshot): ContextSnapshot {
  const str = (value: unknown, limit = 500) => typeof value === "string" && value.trim() ? value.trim().slice(0, limit) : undefined;
  const body = str(input.text, Infinity);
  const clipped = body ? clipText(body, MAX_CONTEXT_TEXT) : undefined;
  const selected = str(input.selection?.text, Infinity);
  const url = str(input.url, 2000);
  const kinds: ContextSnapshot["kind"][] = ["article", "book", "document", "page", "other"];
  return {
    sourceId: str(input.sourceId, 100) ?? "unknown",
    sourceName: str(input.sourceName, 100) ?? str(input.sourceId, 100) ?? "",
    kind: kinds.includes(input.kind) ? input.kind : "other",
    title: str(input.title) ?? "未命名",
    url: url && /^https?:\/\//i.test(url) ? url : undefined,
    path: str(input.path, 1000),
    author: str(input.author, 200),
    published: str(input.published, 100),
    location: str(input.location, 200),
    text: clipped?.text,
    truncated: clipped ? clipped.truncated || input.truncated === true : undefined,
    selection: selected ? { text: clipText(selected, MAX_SELECTION_TEXT).text, location: str(input.selection?.location, 200) } : undefined,
  };
}

export function snapshotKey(snapshot: ContextSnapshot): string {
  return [snapshot.sourceId, snapshot.url ?? snapshot.path ?? snapshot.title, snapshot.location ?? "", snapshot.selection?.text.slice(0, 64) ?? ""].join("|");
}
