import type { ModelSource } from "../../upstream/qiaomu-agent/src/services/model-sources";
import type { Source } from "./native-chat";

export interface NativeModelSelection { provider: string; model: string; reasoningEffort?: string }
export interface NativeModel {
  id: string; name: string;
  reasoning?: { defaultEffort?: string; efforts: { id: string; name?: string }[] };
}
export interface ModelDirectorySnapshot {
  groups: { id: string; name: string; models: NativeModel[] }[];
  current: NativeModelSelection | null;
  status: string;
  error?: string | null;
}
export type NativeResult<T = void> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };
export interface ModelDirectory {
  store: Source<ModelDirectorySnapshot>;
  load(): Promise<ModelDirectorySnapshot>;
  select(selection: NativeModelSelection): Promise<NativeResult>;
}
export const modelSourceKey = (provider: string) => `harness:${encodeURIComponent(provider)}`;

/** Retains the original model picker; the authoritative catalog comes from Harness. */
export function originalModelSources(directory: ModelDirectorySnapshot): ModelSource[] {
  return directory.groups.map(group => ({
    key: modelSourceKey(group.id), kind: "api", label: group.name,
    loaded: directory.status === "ready" || directory.status === "selecting",
    loading: directory.status === "loading", error: directory.error || undefined,
    allowCustom: false, showDefault: false, canListModels: true,
    models: group.models.map(model => ({ id: model.id, name: model.name, efforts: model.reasoning?.efforts.map(effort => effort.id) ?? [] })),
  }));
}

export async function selectOriginalModel(directory: ModelDirectory, source: string, modelId: string, effort?: string): Promise<void> {
  const snapshot = directory.store.getSnapshot();
  const provider = snapshot.groups.find(group => modelSourceKey(group.id) === source);
  const model = provider?.models.find(value => value.id === modelId);
  if (!provider || !model) throw Error("The selected model is no longer in the Harness catalog");
  if (effort && !model.reasoning?.efforts.some(value => value.id === effort)) throw Error("The selected model does not offer that reasoning level");
  const result = await directory.select({ provider: provider.id, model: model.id, ...(effort ? { reasoningEffort: effort } : {}) });
  if (!result.ok) throw Error(`${result.error.code}: ${result.error.message}`);
}

/** Only for a newly created Agent session; never changes another conversation's model. */
export async function selectDefaultFlash(directory: ModelDirectory): Promise<void> {
  const snapshot = await directory.load();
  const group = snapshot.groups.find(value => value.models.some(model => model.id === "deepseek-flash"));
  if (!group) throw Error("Configure deepseek-flash in Harness before starting this session");
  await selectOriginalModel(directory, modelSourceKey(group.id), "deepseek-flash");
}
