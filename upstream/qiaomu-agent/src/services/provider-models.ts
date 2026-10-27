import type { ModelChoice, ProviderConfig } from "../types";
import { connectionText as t } from "../i18n/connection";

function removedIds(provider: ProviderConfig): string[] {
  return Array.isArray(provider.removedModels) ? provider.removedModels.filter(id => typeof id === "string") : [];
}

/** User entries are separate from the replaceable remote catalog. Also migrate older manual IDs. */
export function manualProviderModels(provider: ProviderConfig): Array<Pick<ModelChoice, "id" | "name">> {
  const entries = new Map((Array.isArray(provider.manualModels) ? provider.manualModels : []).filter((model) => model && typeof model.id === "string" && typeof model.name === "string").map((model) => [model.id, model]));
  const reported = new Set((provider.models ?? []).map((model) => model.id));
  if (!provider.fetchedAt) for (const model of provider.models ?? []) if (!entries.has(model.id)) entries.set(model.id, { id: model.id, name: model.name });
  for (const id of provider.enabledModels ?? []) if (!reported.has(id) && !entries.has(id)) entries.set(id, { id, name: id });
  const removed = new Set(removedIds(provider));
  return [...entries.values()].filter(model => !removed.has(model.id));
}
export function providerModels(provider: ProviderConfig): ModelChoice[] {
  const models = new Map<string, ModelChoice>();
  const removed = new Set(removedIds(provider));
  for (const model of provider.models ?? []) if (!removed.has(model.id) && !models.has(model.id)) models.set(model.id, model);
  for (const manual of manualProviderModels(provider)) {
    const remote = models.get(manual.id);
    models.set(manual.id, { ...remote, id: manual.id, name: manual.name !== manual.id ? manual.name : remote?.name ?? manual.id, efforts: remote?.efforts ?? [] });
  }
  return [...models.values()];
}
export function refreshProviderModels(provider: ProviderConfig, remote: ModelChoice[]): ProviderConfig {
  const manual = new Map(manualProviderModels(provider).map((model) => [model.id, model]));
  const removed = new Set(removedIds(provider));
  // A selected model disappearing from discovery is not permission to delete the user's selection.
  for (const id of provider.enabledModels ?? []) if (!removed.has(id) && !remote.some((model) => model.id === id) && !manual.has(id)) {
    const previous = provider.models?.find((model) => model.id === id);
    manual.set(id, { id, name: previous?.name ?? id });
  }
  return { ...provider, models: remote.filter((model, index) => remote.findIndex((entry) => entry.id === model.id) === index), manualModels: [...manual.values()], fetchedAt: Date.now() };
}
function validateModelId(rawId: string): string {
  const id = rawId.trim();
  if (!id || /\s/.test(id) || id.length > 200) throw new Error(t("invalidModel"));
  return id;
}

export function addManualProviderModel(provider: ProviderConfig, rawId: string, rawName = ""): ProviderConfig {
  const id = validateModelId(rawId);
  if (providerModels(provider).some((model) => model.id === id)) throw new Error(t("duplicateModel"));
  return { ...provider, manualModels: [...manualProviderModels(provider), { id, name: rawName.trim() || id }],
    removedModels: removedIds(provider).filter(item => item !== id),
    enabledModels: [...new Set([...(provider.enabledModels ?? []), id])], model: provider.model || id };
}

/** Edit either source without opting a disabled model into chat or mutating the original. */
export function editProviderModel(provider: ProviderConfig, previousId: string, rawId: string, rawName = ""): ProviderConfig {
  const id = validateModelId(rawId);
  const all = providerModels(provider);
  if (!all.some(model => model.id === previousId)) throw new Error(t("modelMissing"));
  if (id !== previousId && all.some(model => model.id === id)) throw new Error(t("duplicateModel"));
  const renamed = id !== previousId;
  const modelOptions = { ...provider.modelOptions };
  if (renamed) {
    const previousOptions = modelOptions[previousId];
    delete modelOptions[previousId];
    delete modelOptions[id];
    if (previousOptions) modelOptions[id] = previousOptions;
  }
  return {
    ...provider,
    // A different ID is a different API model: do not copy vendor-reported capabilities.
    models: renamed ? provider.models?.filter(model => model.id !== previousId) : provider.models,
    manualModels: [...manualProviderModels(provider).filter(model => model.id !== previousId), { id, name: rawName.trim() || id }],
    removedModels: [...new Set([...removedIds(provider).filter(item => item !== id), ...(renamed ? [previousId] : [])])],
    enabledModels: (provider.enabledModels ?? []).map(item => item === previousId ? id : item),
    model: provider.model === previousId ? id : provider.model,
    modelOptions,
  };
}

/** Forget the local configuration; a future catalog refresh must respect this explicit removal. */
export function removeProviderModel(provider: ProviderConfig, id: string): ProviderConfig {
  const enabledModels = (provider.enabledModels ?? []).filter(item => item !== id);
  const modelOptions = { ...provider.modelOptions };
  delete modelOptions[id];
  return {
    ...provider,
    models: provider.models?.filter(model => model.id !== id),
    manualModels: manualProviderModels(provider).filter(model => model.id !== id),
    removedModels: [...new Set([...removedIds(provider), id])],
    enabledModels,
    model: provider.model === id ? enabledModels[0] ?? "" : provider.model,
    modelOptions,
  };
}
