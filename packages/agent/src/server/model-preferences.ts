import type { AgentServiceTier } from "@atelier/shared";
import { getConfiguredModels, getAgentModelPreference, setAgentModelPreference, getAgentModelThinkingLevel, setAgentModelThinkingLevel, getAgentProviderServiceTier, setAgentProviderServiceTier } from "@atelier/llm/server";

export async function getConfiguredAgentModels() {
  const [models, active] = await Promise.all([getConfiguredModels(), getAgentModelPreference("builtin")]);
  const selected = models.find((model) => model.provider === active?.provider && model.id === active?.id) ?? models[0];
  return models.map((model) => ({ ...model, active: model === selected }));
}

export function setActiveAgentModel(provider: string, id: string, thinkingLevel?: string): Promise<void> {
  return setAgentModelPreference("builtin", { provider, id }, thinkingLevel);
}

export function getModelThinkingLevel(provider: string, id: string): Promise<string | undefined> {
  return getAgentModelThinkingLevel("builtin", { provider, id });
}

export function setModelThinkingLevel(provider: string, id: string, thinkingLevel: string): Promise<void> {
  return setAgentModelThinkingLevel("builtin", { provider, id }, thinkingLevel);
}

export function getLastProviderServiceTier(provider: string): Promise<AgentServiceTier | undefined> {
  return getAgentProviderServiceTier("builtin", provider);
}

export function setLastProviderServiceTier(provider: string, serviceTier: AgentServiceTier): Promise<void> {
  return setAgentProviderServiceTier("builtin", provider, serviceTier);
}

export async function reconcileAgentModelPreferences(): Promise<void> {
  const [models, active] = await Promise.all([getConfiguredModels(), getAgentModelPreference("builtin")]);
  if (models.some((model) => model.provider === active?.provider && model.id === active?.id)) return;
  await setAgentModelPreference("builtin", models[0]);
}
