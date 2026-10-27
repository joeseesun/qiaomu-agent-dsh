import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { Menu, Platform } from "obsidian";
import { Library, Pin, Search, Settings2, X } from "lucide-react";
import { ComposerPopover } from "./composer-popover";
import { byUsage, isEnabled, matchesPrompt, SOURCE_NAMES, stripPrompts, type PromptItem, type PromptSettings } from "../services/prompt-library";
import type { PromptField } from "../services/prompt-template";
import type { StarterScene } from "../services/starter-prompts";

export interface PromptActions {
  run: (item: PromptItem) => void;
  insert: (item: PromptItem) => void;
  edit: (item: PromptItem) => void;
  togglePin: (item: PromptItem) => void;
  manage: () => void;
}

/** Right click (or long press) on a prompt: the choices other than running it. */
function promptMenu(event: MouseEvent, item: PromptItem, pinned: boolean, actions: PromptActions) {
  event.preventDefault();
  const menu = new Menu();
  menu.addItem((entry) => entry.setTitle("填入输入框").setIcon("text-cursor-input").onClick(() => actions.insert(item)));
  menu.addItem((entry) => entry.setTitle(pinned ? "从快捷条移除" : "固定到快捷条").setIcon(pinned ? "pin-off" : "pin").onClick(() => actions.togglePin(item)));
  menu.addItem((entry) => entry.setTitle("编辑…").setIcon("pencil").onClick(() => actions.edit(item)));
  menu.addSeparator();
  menu.addItem((entry) => entry.setTitle("管理 Prompt 库…").setIcon("library").onClick(() => actions.manage()));
  menu.showAtMouseEvent(event.nativeEvent);
}

/** Prompts above the composer: one click sends, right click offers the rest, the last button opens all of them. */
export function PromptStrip({ catalog, settings, scene, disabled, actions }: {
  catalog: PromptItem[]; settings: PromptSettings; scene: StarterScene; disabled: boolean; actions: PromptActions;
}) {
  const labelId = useId();
  const items = stripPrompts(catalog, settings, scene);
  return <div className="qa-prompt-strip" role="group" aria-labelledby={labelId}>
    <span id={labelId} className="qiaomu-agent__sr-only">常用 Prompt，点击直接发送，右键查看更多操作</span>
    <div className="qa-prompt-chips">{items.map((item) => {
      const pinned = settings.pinned.includes(item.id);
      return <button key={item.id} type="button" disabled={disabled} className={pinned ? "is-pinned" : undefined}
        title={Platform.isMobile ? undefined : `${item.title}\n点击发送 · 右键更多`}
        onClick={() => actions.run(item)} onContextMenu={(event) => promptMenu(event, item, pinned, actions)}>
        {pinned && <Pin size={11} aria-hidden="true" />}<span>{item.title}</span></button>;
    })}</div>
    <ComposerPopover className="qa-prompt-more" label="全部 Prompt" iconOnly trigger={<Library size={14} />}>
      {(close) => <PromptPicker catalog={catalog} settings={settings} scene={scene} disabled={disabled}
        onRun={(item) => { close(); actions.run(item); }} onManage={() => { close(); actions.manage(); }}
        onMenu={(event, item) => promptMenu(event, item, settings.pinned.includes(item.id), { ...actions, run: (i) => { close(); actions.run(i); } })} />}
    </ComposerPopover>
  </div>;
}

/** Enabled prompts grouped the way they are used: pinned, this screen, most used, then the rest by category. */
export function promptGroups(catalog: PromptItem[], settings: PromptSettings, scene: StarterScene, query: string): Array<{ name: string; items: PromptItem[] }> {
  const enabled = catalog.filter((item) => isEnabled(item, settings) && matchesPrompt(item, query));
  if (query.trim()) return [{ name: "搜索结果", items: byUsage(enabled, settings) }];
  const taken = new Set<string>();
  const take = (items: PromptItem[]) => items.filter((item) => !taken.has(item.id) && taken.add(item.id));
  const groups = [
    { name: "已固定", items: take(settings.pinned.flatMap((id) => enabled.filter((item) => item.id === id))) },
    { name: "适合现在", items: take(enabled.filter((item) => item.scenes?.includes(scene) || (scene === "daily" && item.scenes?.includes("note")))) },
    { name: "最近常用", items: take(byUsage(enabled.filter((item) => settings.usage[item.id]), settings).slice(0, 5)) },
    { name: "我的", items: take(enabled.filter((item) => item.source === "user")) },
  ];
  const rest = new Map<string, PromptItem[]>();
  for (const item of take(enabled)) {
    const name = item.source === "scene" ? item.category ?? "场景" : `${SOURCE_NAMES[item.source]} · ${item.category ?? "其他"}`;
    rest.set(name, [...rest.get(name) ?? [], item]);
  }
  return [...groups, ...[...rest].map(([name, items]) => ({ name, items }))].filter((group) => group.items.length);
}

function PromptPicker({ catalog, settings, scene, disabled, onRun, onManage, onMenu }: {
  catalog: PromptItem[]; settings: PromptSettings; scene: StarterScene; disabled: boolean;
  onRun: (item: PromptItem) => void; onManage: () => void; onMenu: (event: MouseEvent, item: PromptItem) => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  const groups = promptGroups(catalog, settings, scene, query);
  const flat = groups.flatMap((group) => group.items);
  useEffect(() => setActive(0), [query]);
  useEffect(() => { list.current?.querySelector<HTMLElement>(`#${CSS.escape(`${id}-${active}`)}`)?.scrollIntoView?.({ block: "nearest" }); }, [active, id]);
  const keys = (event: KeyboardEvent) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setActive((n) => flat.length ? (n + (event.key === "ArrowDown" ? 1 : flat.length - 1)) % flat.length : 0); }
    if (event.key === "Enter" && flat[active] && !disabled) { event.preventDefault(); onRun(flat[active]!); }
  };
  let index = -1;
  return <div className="qa-prompt-picker">
    <label className="qa-prompt-search"><Search size={14} aria-hidden="true" /><span className="qiaomu-agent__sr-only">搜索 Prompt</span>
      <input type="search" value={query} placeholder="搜索 Prompt" onChange={(event) => setQuery(event.currentTarget.value)} onKeyDown={keys}
        role="combobox" aria-expanded="true" aria-controls={`${id}-list`} aria-activedescendant={flat.length ? `${id}-${active}` : undefined} /></label>
    <div className="qa-prompt-list" id={`${id}-list`} role="listbox" aria-label="Prompt" ref={list}>
      {groups.map((group) => <div key={group.name} role="group" aria-label={group.name}>
        <div className="qa-command-group" aria-hidden="true">{group.name}</div>
        {group.items.map((item) => { index++; const at = index; return <button key={item.id} id={`${id}-${at}`} type="button" role="option" aria-selected={at === active} disabled={disabled}
          onMouseEnter={() => setActive(at)} onClick={() => onRun(item)} onContextMenu={(event) => onMenu(event, item)}>
          <span className="qa-prompt-title">{item.title}</span>
          {settings.pinned.includes(item.id) && <Pin size={12} aria-label="已固定" />}
        </button>; })}
      </div>)}
      {!flat.length && <div className="qa-command-empty">{query ? "没有匹配的 Prompt" : "还没有启用的 Prompt"}</div>}
    </div>
    <div className="qa-prompt-picker-foot">
      <span>{Platform.isMobile ? "长按查看更多操作" : "↵ 发送 · 右键更多"}</span>
      <button type="button" onClick={onManage}><Settings2 size={14} aria-hidden="true" /><span>管理 Prompt 库</span></button>
    </div>
  </div>;
}

/** The blanks a prompt needs, asked right above the composer; Enter in the last one sends. */
export function PromptForm({ item, fields, values, onChange, onSubmit, onCancel }: {
  item: PromptItem; fields: PromptField[]; values: Record<string, string>;
  onChange: (name: string, value: string) => void; onSubmit: () => void; onCancel: () => void;
}) {
  const id = useId();
  const first = useRef<HTMLTextAreaElement & HTMLSelectElement>(null);
  useEffect(() => { first.current?.focus(); }, [item.id]);
  const keys = (event: KeyboardEvent, last: boolean) => {
    if (event.key === "Escape") { event.preventDefault(); onCancel(); }
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && (last || event.metaKey || event.ctrlKey)) { event.preventDefault(); onSubmit(); }
  };
  return <form className="qa-prompt-form" aria-labelledby={`${id}-title`} onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
    <div className="qa-prompt-form-head">
      <span id={`${id}-title`}>{item.title.replace(/…$/, "")}</span>
      <button type="button" onClick={onCancel} aria-label="取消"><X size={14} /></button>
    </div>
    {fields.map((field, index) => {
      const last = index === fields.length - 1;
      const inputId = `${id}-${index}`;
      return <div key={field.name} className="qa-prompt-field">
        <label htmlFor={inputId}>{field.name}</label>
        {field.options?.length
          ? <select id={inputId} ref={index === 0 ? first : undefined} value={values[field.name] ?? field.defaultValue ?? ""} onChange={(event) => onChange(field.name, event.currentTarget.value)} onKeyDown={(event) => keys(event, last)}>
            {field.options.map((option) => <option key={option} value={option}>{option}</option>)}</select>
          : <textarea id={inputId} ref={index === 0 ? first : undefined} rows={1} value={values[field.name] ?? ""} placeholder={field.defaultValue ?? ""}
            onChange={(event) => { onChange(field.name, event.currentTarget.value); event.currentTarget.style.removeProperty("--qa-prompt-height"); event.currentTarget.style.setProperty("--qa-prompt-height", `${Math.min(event.currentTarget.scrollHeight, 140)}px`); }}
            onKeyDown={(event) => keys(event, last)} />}
      </div>;
    })}
    <div className="qa-prompt-form-actions">
      <span>{Platform.isMobile ? "" : fields.length > 1 ? "⌘↵ 发送 · Esc 取消" : "↵ 发送 · ⇧↵ 换行 · Esc 取消"}</span>
      <button type="submit" className="qa-prompt-form-send">发送</button>
    </div>
  </form>;
}
