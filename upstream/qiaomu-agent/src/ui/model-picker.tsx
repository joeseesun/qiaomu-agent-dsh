import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Check, Clock, LayoutGrid, RefreshCw, Search, Settings2 } from "lucide-react";
import type { ModelSource } from "../services/model-sources";
import { BrandIcon } from "./brand-icon";
import { effortLabel } from "./composer-popover";

export interface PickerSelection { source: string; model: string; }

interface Props {
  sources: ModelSource[];
  current: PickerSelection | null;
  recent: PickerSelection[];
  efforts: string[];
  effort: string;
  onEffort: (effort: string) => void;
  onSelect: (source: string, model: string) => void;
  onLoad: (source: string) => void;
  onManage: () => void;
}

type Row =
  | { type: "header"; key: string; label: string }
  | { type: "model"; key: string; source: ModelSource; id: string; name: string; showSource: boolean; meta?: string }
  | { type: "load"; key: string; source: ModelSource }
  | { type: "note"; key: string; text: string }
  | { type: "custom"; key: string; source: ModelSource; id: string };

const ALL = "__all";
const RECENT = "__recent";

function matches(query: string, ...values: string[]): boolean {
  return !query || values.some((value) => value.toLowerCase().includes(query));
}

/** Unified model picker: every agent and provider in one list, grouped by source (after magpie). */
export function ModelPicker({ sources, current, recent, efforts, effort, onEffort, onSelect, onLoad, onManage }: Props) {
  const [query, setQuery] = useState("");
  const [rail, setRail] = useState(ALL);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const sourceLabelId = useId();
  const effortLabelId = useId();
  useEffect(() => { search.current?.focus(); }, []);
  // A rail source that disappears (provider removed) falls back to "all".
  useEffect(() => { if (rail !== ALL && rail !== RECENT && !sources.some((s) => s.key === rail)) setRail(ALL); }, [rail, sources]);

  const bySource = useMemo(() => new Map(sources.map((source) => [source.key, source])), [sources]);
  const q = query.trim().toLowerCase();
  // Filtering by source only pays off once the list is long; a few sources read fine as one list.
  const showRail = rail !== ALL || sources.reduce((total, source) => total + source.models.length + (source.kind === "agent" ? 1 : 0), 0) > 12;

  const rows = useMemo<Row[]>(() => {
    const result: Row[] = [];
    if (rail === RECENT) {
      for (const item of recent) {
        const source = bySource.get(item.source);
        if (!source) continue;
        if (source.kind === "api" && !source.models.some((model) => model.id === item.model)) continue;
        if (source.kind === "agent" && (item.model ? !source.models.some((model) => model.id === item.model) : source.showDefault === false)) continue;
        const name = source.models.find((m) => m.id === item.model)?.name ?? item.model;
        if (matches(q, name, item.model, source.label)) result.push({ type: "model", key: `r:${item.source}:${item.model}`, source, id: item.model, name, showSource: true });
      }
      if (!result.length) result.push({ type: "note", key: "empty", text: q ? "没有匹配的模型" : "还没有最近使用的模型" });
      return result;
    }
    const visible = rail === ALL ? sources : sources.filter((source) => source.key === rail);
    for (const source of visible) {
      const sourceHit = matches(q, source.label);
      const models = source.models.filter((m) => sourceHit || matches(q, m.name, m.id));
      const group: Row[] = [];
      if (source.kind === "agent" && source.showDefault !== false && (sourceHit || matches(q, "默认模型"))) {
        group.push({ type: "model", key: `${source.key}:`, source, id: "", name: "默认模型", showSource: false });
      }
      for (const model of models) group.push({ type: "model", key: `${source.key}:${model.id}`, source, id: model.id, name: model.name || model.id, showSource: false });
      // Listing an agent's models starts its process, so only offer it when that agent is in focus.
      // In the full list that is the agent in use; other agents stay one row until picked.
      const focused = rail === source.key || (rail === ALL && current?.source === source.key);
      if (source.kind === "agent" && source.canListModels && !source.loaded && !q && focused) group.push({ type: "load", key: `${source.key}:load`, source });
      if (source.error && !q && rail === source.key) group.push({ type: "note", key: `${source.key}:error`, text: source.error });
      if (!group.length) continue;
      // A source offering only its default model is one row, not a heading over a lone "默认模型".
      const [only] = group;
      if (visible.length > 1 && group.length === 1 && only?.type === "model" && only.id === "") {
        result.push({ ...only, name: source.label, meta: "默认模型" });
        continue;
      }
      if (visible.length > 1) result.push({ type: "header", key: `${source.key}:header`, label: source.label });
      result.push(...group);
    }
    const target = rail !== ALL ? bySource.get(rail) : current ? bySource.get(current.source) : undefined;
    if (query.trim() && target?.kind === "agent" && target.allowCustom !== false && !result.some((row) => row.type === "model" && row.source.key === target.key && row.id === query.trim())) {
      result.push({ type: "custom", key: "custom", source: target, id: query.trim() });
    }
    if (!result.length) result.push({ type: "note", key: "empty", text: sources.length ? "没有匹配的模型" : "还没有可用的模型来源，先添加服务商或安装本地 Agent。" });
    return result;
  }, [rail, recent, sources, bySource, q, query, current]);

  const focusItem = (step: 1 | -1, from?: Element | null) => {
    const items = Array.from(list.current?.querySelectorAll<HTMLButtonElement>("button.qa-picker-item") ?? []);
    if (!items.length) return;
    const index = from ? items.indexOf(from as HTMLButtonElement) : -1;
    const next = index < 0 ? (step === 1 ? 0 : items.length - 1) : index + step;
    if (next < 0) { search.current?.focus(); return; }
    items[Math.min(next, items.length - 1)]?.focus();
  };
  const onListKey = (event: KeyboardEvent) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    focusItem(event.key === "ArrowDown" ? 1 : -1, event.target as Element);
  };
  const choose = (row: Row) => {
    if (row.type === "model" || row.type === "custom") onSelect(row.source.key, row.id);
    else if (row.type === "load") onLoad(row.source.key);
  };

  const railButton = (key: string, label: string, icon: ReactNode) => (
    <button key={key} type="button" className="qa-picker-rail-item" aria-pressed={rail === key}
      onClick={() => {
        setRail(key);
        const source = bySource.get(key);
        if (source?.canListModels && !source.loaded && !source.loading && !source.error) onLoad(key);
        search.current?.focus();
      }}>{icon}<span className="qiaomu-agent__sr-only">{label}</span></button>
  );

  return <div className="qa-picker">
    <label className="qa-picker-search">
      <Search size={14} aria-hidden="true" />
      <span className="qiaomu-agent__sr-only">筛选模型</span>
      <input ref={search} placeholder="筛选模型" value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") { event.preventDefault(); focusItem(1); }
          if (event.key === "Enter" && !event.nativeEvent.isComposing) {
            const first = rows.find((row) => row.type === "model" || row.type === "custom");
            if (first) { event.preventDefault(); choose(first); }
          }
        }} />
    </label>
    <div className="qa-picker-body">
      {showRail && <div className="qa-picker-rail" role="toolbar" aria-labelledby={sourceLabelId} aria-orientation="vertical">
        <span id={sourceLabelId} className="qiaomu-agent__sr-only">模型来源</span>
        {railButton(ALL, "全部模型", <LayoutGrid size={15} />)}
        {recent.length > 0 && railButton(RECENT, "最近使用", <Clock size={15} />)}
        {sources.length > 0 && <span className="qa-picker-rail-sep" aria-hidden="true" />}
        {sources.map((source) => railButton(source.key, source.label, <BrandIcon icon={source.icon} kind={source.kind} size={16} />))}
      </div>}
      <div ref={list} className="qa-picker-list" onKeyDown={onListKey}>
        {rail !== ALL && rail !== RECENT && <div className="qa-picker-active-source">{bySource.get(rail)?.label}</div>}
        {rows.map((row) => {
          if (row.type === "header") return <div key={row.key} className="qa-picker-group">{row.label}</div>;
          if (row.type === "note") return <p key={row.key} className="qa-picker-note">{row.text}</p>;
          if (row.type === "load") return <button key={row.key} type="button" className="qa-picker-item qa-picker-load" disabled={row.source.loading} onClick={() => choose(row)}>
            <RefreshCw size={14} className={row.source.loading ? "is-spinning" : undefined} aria-hidden="true" />
            <span className="qa-picker-name">{row.source.loading ? "正在获取模型…" : "获取模型列表"}</span>
          </button>;
          if (row.type === "custom") return <button key={row.key} type="button" className="qa-picker-item" onClick={() => choose(row)}>
            <BrandIcon icon={row.source.icon} kind={row.source.kind} />
            <span className="qa-picker-name">使用「{row.id}」</span><span className="qa-picker-meta">{row.source.label}</span>
          </button>;
          const selected = current?.source === row.source.key && current.model === row.id;
          return <button key={row.key} type="button" className="qa-picker-item" aria-pressed={selected} onClick={() => choose(row)}>
            <BrandIcon icon={row.source.icon} kind={row.source.kind} />
            <span className="qa-picker-name">{row.name}</span>
            {(row.meta || row.showSource) && <span className="qa-picker-meta">{row.meta ?? row.source.label}</span>}
            {selected && <Check size={14} className="qa-picker-check" aria-hidden="true" />}
          </button>;
        })}
      </div>
    </div>
    {efforts.length > 0 && <div className="qa-picker-effort" role="radiogroup" aria-labelledby={effortLabelId}>
      <span id={effortLabelId} className="qiaomu-agent__sr-only">推理强度</span><span>推理</span>
      {["", ...efforts].map((value) => <button key={value || "default"} type="button" role="radio" aria-checked={effort === value} onClick={() => onEffort(value)}>{effortLabel(value)}</button>)}
    </div>}
    <div className="qa-picker-footer">
      <button type="button" onClick={onManage}><Settings2 size={14} />模型设置</button>
    </div>
  </div>;
}
