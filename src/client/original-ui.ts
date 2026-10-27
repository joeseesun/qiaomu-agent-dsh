export * from "./harness-ui";
export { default as moment } from "moment";
import { icons } from "lucide";
import { Modal, createEl, enhance, Notice, onRemove } from "./harness-ui";

export class Events {
  private listeners = new Map<string, Set<(...args: any[]) => void>>();
  on(name: string, fn: (...args: any[]) => void, context?: any) {
    const listener = context ? fn.bind(context) : fn;
    let set = this.listeners.get(name);
    if (!set) this.listeners.set(name, (set = new Set()));
    set.add(listener);
    return () => {
      set!.delete(listener);
      if (!set!.size) this.listeners.delete(name);
    };
  }
  off(name: string, fn: any) {
    this.listeners.get(name)?.delete(fn);
  }
  offref(ref: () => void) {
    ref();
  }
  trigger(name: string, ...args: any[]) {
    for (const fn of [...(this.listeners.get(name) || [])]) fn(...args);
  }
  clear() {
    this.listeners.clear();
  }
}
export class Component {
  private cleanups: Array<() => void> = [];
  private children = new Set<Component>();
  private loaded = false;
  private disposed = false;
  load() {
    if (this.loaded || this.disposed) return;
    this.loaded = true;
    this.onload();
    for (const child of this.children) child.load();
  }
  unload() {
    if (this.disposed) return;
    this.disposed = true;
    try {
      this.onunload();
    } finally {
      for (const child of this.children) child.unload();
      this.children.clear();
      for (const fn of this.cleanups.splice(0).reverse()) fn();
    }
  }
  onload() {}
  onunload() {}
  register(fn: () => void) {
    if (this.disposed) fn();
    else this.cleanups.push(fn);
  }
  registerEvent(ref: () => void) {
    this.register(ref);
  }
  registerDomEvent(el: EventTarget, event: string, fn: any, options?: any) {
    el.addEventListener(event, fn, options);
    this.register(() => el.removeEventListener(event, fn, options));
  }
  registerInterval(id: any) {
    this.register(() => clearInterval(id));
  }
  addChild<T extends Component>(child: T) {
    this.children.add(child);
    if (this.loaded) child.load();
    return child;
  }
  removeChild(child: Component) {
    child.unload();
    this.children.delete(child);
  }
}
export class ItemView extends Component {
  app: any;
  leaf: any;
  contentEl: any;
  containerEl: any;
  navigation = true;
  constructor(leaf: any) {
    super();
    this.leaf = leaf;
    this.app = leaf.app;
    this.containerEl = enhance(leaf.containerEl || leaf.contentEl);
    this.contentEl = enhance(leaf.contentEl);
  }
}
export class MarkdownView extends ItemView {}
export class TAbstractFile {
  name: string;
  parent: TFolder | null = null;
  constructor(public path: string) {
    this.name = path.split("/").at(-1) || "";
  }
}
export class TFolder extends TAbstractFile {
  children: TAbstractFile[] = [];
  isRoot() {
    return this.path === "/" || !this.path;
  }
}
export class TFile extends TAbstractFile {
  extension: string;
  basename: string;
  constructor(
    path: string,
    public stat: any = {},
  ) {
    super(path);
    this.extension = this.name.includes(".")
      ? this.name.split(".").at(-1)!
      : "";
    this.basename = this.extension
      ? this.name.slice(0, -this.extension.length - 1)
      : this.name;
  }
}
export const Keymap = { isModEvent: (e: any) => !!(e.metaKey || e.ctrlKey) };
export function debounce<T extends (...args: any[]) => void>(
  fn: T,
  delay: number,
  resetTimer = true,
) {
  let timer: any;
  const run = (...args: Parameters<T>) => {
    if (timer && !resetTimer) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, delay);
  };
  run.cancel = () => {
    clearTimeout(timer);
    timer = null;
  };
  return run;
}
export const getIconIds = () =>
  Object.keys(icons).map((key) =>
    key.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase(),
  );
export const setTooltip = (el: HTMLElement, text: string) =>
  el.setAttribute("aria-label", text);
export function getAllTags(cache: any) {
  const tags = (cache.tags || []).map((item: any) => item.tag);
  let front = cache.frontmatter?.tags ?? [];
  if (typeof front === "string") front = front.split(/[,\s]+/);
  if (Array.isArray(front))
    for (const value of front)
      if (typeof value === "string" && value.trim())
        tags.push("#" + value.trim().replace(/^#/, ""));
  return [...new Set(tags)];
}
/** Host-independent subsequence matching. Exact/name/alias/recent ranking stays in original search.ts. */
export function prepareFuzzySearch(query: string) {
  const chars = Array.from(query.toLocaleLowerCase());
  return (text: string) => {
    const value = text.toLocaleLowerCase();
    let next = 0,
      last = -1,
      score = 0;
    const matches: number[][] = [];
    for (const char of chars) {
      const at = value.indexOf(char, next);
      if (at < 0) return null;
      score -= at - last - 1;
      matches.push([at, at + char.length]);
      last = at;
      next = at + char.length;
    }
    return { score, matches };
  };
}

// This transport is provided by the owning Harness plugin and removed on disposal.
let transport: ((request: any) => Promise<any>) | undefined;
export function setRequestTransport(value: (request: any) => Promise<any>) {
  transport = value;
  return () => {
    if (transport === value) transport = undefined;
  };
}
export function requestUrl(request: any) {
  if (!transport)
    return Promise.reject(Error("Home host transport is unavailable"));
  return transport(typeof request === "string" ? { url: request } : request);
}

export class SuggestModal<T> extends Modal {
  inputEl: any;
  resultContainerEl: any;
  private generation = 0;
  private cursor = -1;
  private results: T[] = [];
  constructor(app: any) {
    super(app);
    this.inputEl = this.contentEl.createEl("input", {
      type: "search",
      attr: {
        "aria-label": "Search",
        role: "combobox",
        "aria-autocomplete": "list",
        "aria-expanded": "true",
      },
    });
    this.resultContainerEl = this.contentEl.createDiv({
      cls: "suggestion-container",
      attr: { role: "listbox" },
    });
    const id = "qh-suggest-" + crypto.randomUUID();
    this.resultContainerEl.id = id;
    this.inputEl.setAttribute("aria-controls", id);
    this.inputEl.addEventListener("input", () => void this.refresh());
    this.inputEl.addEventListener("keydown", (event: KeyboardEvent) => {
      if (["ArrowDown", "ArrowUp"].includes(event.key)) {
        event.preventDefault();
        this.cursor =
          (this.cursor +
            (event.key === "ArrowDown" ? 1 : -1) +
            this.results.length) %
          this.results.length;
        this.paint();
      } else if (event.key === "Enter" && this.results.length) {
        event.preventDefault();
        this.choose(this.results[Math.max(0, this.cursor)]!, event);
      }
    });
  }
  setPlaceholder(text: string) {
    this.inputEl.placeholder = text;
    return this;
  }
  getSuggestions(_query: string): T[] | Promise<T[]> {
    return [];
  }
  renderSuggestion(item: T, el: any) {
    el.setText(String(item));
  }
  onChooseSuggestion(_item: T, _event?: MouseEvent | KeyboardEvent) {}
  private choose(item: T, event?: MouseEvent | KeyboardEvent) {
    this.close();
    Promise.resolve()
      .then(() => this.onChooseSuggestion(item, event))
      .catch((error) => new Notice(error.message));
  }
  private paint() {
    this.resultContainerEl.empty();
    this.results.forEach((item, index) => {
      const el = this.resultContainerEl.createDiv({
        cls: "suggestion-item",
        attr: {
          role: "option",
          "aria-selected": String(index === this.cursor),
          id: this.resultContainerEl.id + "-" + index,
        },
      });
      this.renderSuggestion(item, el);
      el.addEventListener("click", (event: MouseEvent) =>
        this.choose(item, event),
      );
    });
    if (this.cursor >= 0)
      this.inputEl.setAttribute(
        "aria-activedescendant",
        this.resultContainerEl.id + "-" + this.cursor,
      );
    else this.inputEl.removeAttribute("aria-activedescendant");
  }
  private async refresh() {
    const generation = ++this.generation;
    try {
      const values = await this.getSuggestions(this.inputEl.value);
      if (generation !== this.generation || !this.opened) return;
      this.results = values.slice(0, 200);
      this.cursor = this.results.length ? 0 : -1;
      this.paint();
    } catch (error: any) {
      if (this.opened && generation === this.generation)
        new Notice(error.message);
    }
  }
  override onOpen() {
    void this.refresh();
    queueMicrotask(() => {
      if (this.opened) this.inputEl.focus();
    });
  }
  override onClose() {
    this.generation++;
  }
}
export class FuzzySuggestModal<T> extends SuggestModal<T> {
  getItems(): T[] {
    return [];
  }
  getItemText(item: T) {
    return String(item);
  }
  override getSuggestions(query: string) {
    const match = prepareFuzzySearch(query);
    return this.getItems()
      .map((item) => ({ item, hit: match(this.getItemText(item)) }))
      .filter((entry) => entry.hit)
      .sort((a, b) => b.hit!.score - a.hit!.score)
      .map((entry) => entry.item);
  }
  override renderSuggestion(item: T, el: any) {
    el.setText(this.getItemText(item));
  }
  onChooseItem(_item: T, _event?: MouseEvent | KeyboardEvent) {}
  override onChooseSuggestion(item: T, event?: MouseEvent | KeyboardEvent) {
    return this.onChooseItem(item, event);
  }
}
export class AbstractInputSuggest<T> {
  private root: any;
  private generation = 0;
  private disposed = false;
  constructor(
    public app: any,
    private field: HTMLInputElement,
  ) {
    field.addEventListener("input", this.refresh);
    field.addEventListener("focus", this.refresh);
    field.addEventListener("blur", this.blur);
    onRemove(field, () => this.dispose());
  }
  getSuggestions(_query: string): T[] | Promise<T[]> {
    return [];
  }
  renderSuggestion(item: T, el: any) {
    el.setText(String(item));
  }
  selectSuggestion(_item: T) {}
  refresh = async () => {
    const generation = ++this.generation;
    const entries = await this.getSuggestions(this.field.value);
    if (
      this.disposed ||
      generation !== this.generation ||
      !this.field.isConnected
    )
      return;
    this.root?.remove();
    this.root = createEl("div", {
      cls: "qh-ui suggestion-container",
      attr: { role: "listbox" },
    });
    for (const item of entries.slice(0, 50)) {
      const row = this.root.createEl("button", {
        type: "button",
        cls: "suggestion-item",
      });
      this.renderSuggestion(item, row);
      row.addEventListener("pointerdown", (event: Event) =>
        event.preventDefault(),
      );
      row.addEventListener("click", () => this.selectSuggestion(item));
    }
    this.field.insertAdjacentElement("afterend", this.root);
  };
  blur = () => this.close();
  close() {
    this.generation++;
    this.root?.remove();
    this.root = null;
  }
  dispose() {
    this.disposed = true;
    this.close();
    this.field.removeEventListener("input", this.refresh);
    this.field.removeEventListener("focus", this.refresh);
    this.field.removeEventListener("blur", this.blur);
  }
}
/** Picks a keychain reference; plaintext is only passed to the host's explicit save action. */
export class SecretComponent {
  private select: any;
  private value = "";
  private changed: (value: string) => any = () => {};
  constructor(
    private app: any,
    el: any,
  ) {
    this.select = el.createEl("select", {
      attr: { "aria-label": "Saved credential" },
    });
    this.render();
    this.select.addEventListener("change", () => {
      this.value = this.select.value;
      Promise.resolve(this.changed(this.value)).catch(
        (error) => new Notice(error.message),
      );
    });
    const button = el.createEl("button", {
      text: "保存密钥 / Save key",
      type: "button",
    });
    button.addEventListener("click", () => {
      const modal = new Modal(app);
      modal.setTitle("保存密钥 / Save credential");
      const name = modal.contentEl.createEl("input", {
        placeholder: "Key name",
        value: this.value,
        attr: { "aria-label": "Key name" },
      });
      const input = modal.contentEl.createEl("input", {
        type: "password",
        attr: { "aria-label": "Credential", autocomplete: "off" },
      });
      const save = modal.contentEl.createEl("button", {
        text: "保存 / Save",
        type: "button",
      });
      save.onclick = async () => {
        save.disabled = true;
        try {
          const id = name.value.trim();
          if (!/^[a-zA-Z0-9_.-]{1,100}$/.test(id) || !input.value)
            throw Error("Enter a name and credential");
          await app.secretStorage.setSecret(id, input.value);
          input.value = "";
          this.setValue(id);
          await this.changed(id);
          modal.close();
        } catch (error: any) {
          new Notice(error.message);
          save.disabled = false;
        }
      };
      modal.open();
    });
  }
  private render() {
    this.select.empty();
    this.select.createEl("option", { text: "—", attr: { value: "" } });
    const ids = new Set<string>(this.app.secretStorage.listSecrets());
    if (this.value) ids.add(this.value);
    for (const id of ids)
      this.select.createEl("option", { text: id, attr: { value: id } });
    this.select.value = this.value;
  }
  setValue(value: string) {
    this.value = value;
    this.render();
    return this;
  }
  onChange(fn: (value: string) => any) {
    this.changed = fn;
    return this;
  }
}

/** Lifecycle hooks delegate to the owning Harness mount, command registry and state lane. */
export class Plugin extends Component {
  constructor(
    public app: any,
    public manifest: any,
  ) {
    super();
  }
  loadData() {
    return this.app.home.state.getSnapshot()?.data;
  }
  saveData(data: any) {
    return this.app.home.state.save(data);
  }
  registerView(type: string, factory: any) {
    return this.app.home.registerView(type, factory);
  }
  addSettingTab(tab: any) {
    return this.app.home.registerSettings(tab);
  }
  addCommand(command: any) {
    this.register(
      this.app.home.registerCommand(
        this.manifest.id + ":" + command.id,
        command,
      ),
    );
    return command;
  }
  addRibbonIcon(icon: string, label: string, run: () => void) {
    return this.app.home.registerLauncher({ icon, label, run });
  }
}
