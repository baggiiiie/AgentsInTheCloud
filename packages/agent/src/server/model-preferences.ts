import { getConfiguredModels, getAgentModelPreference, setAgentModelPreference } from "@agents-in-the-cloud/llm/server";

export async function getConfiguredAgentModels() {
  const [models, active] = await Promise.all([getConfiguredModels(), getAgentModelPreference("builtin")]);
  const selected = models.find((model) => model.provider === active?.provider && model.id === active?.id) ?? models[0];
  return models.map((model) => ({ ...model, active: model === selected }));
}

export async function reconcileAgentModelPreferences(): Promise<void> {
  const [models, active] = await Promise.all([getConfiguredModels(), getAgentModelPreference("builtin")]);
  if (models.some((model) => model.provider === active?.provider && model.id === active?.id)) return;
  await setAgentModelPreference("builtin", models[0]);
}
