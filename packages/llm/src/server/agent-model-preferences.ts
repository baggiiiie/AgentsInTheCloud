import { readJsonSettings, updateJsonSettings } from "@atelier/core/json-settings";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { atelierDataPath, getAtelierRuntimeContext, isJsonObject, type JsonObject, type JsonValue } from "@atelier/core";
import type { AgentServiceTier } from "@atelier/shared";
import { modelRefValue, type ModelRef } from "./model-reference.ts";

function settingsPath(): string { return atelierDataPath(getAtelierRuntimeContext(), "pi-config", "models.json"); }
const stringSchema = Type.String();
function object(value: JsonValue | undefined): JsonObject { return isJsonObject(value) ? value : {}; }

function preferences(stored: JsonObject, agent: string): JsonObject {
  const scoped = object(stored.agentPreferences)[agent];
  if (isJsonObject(scoped)) return scoped;
  // Older settings used unscoped keys for the Built-in Agent only.
  return agent === "builtin" ? {
    activeModel: stored.activeModel ?? null,
    modelPreferences: stored.modelPreferences ?? {},
    providerPreferences: stored.providerPreferences ?? {},
  } : {};
}

async function update(agent: string, change: (preference: JsonObject) => void): Promise<void> {
  await updateJsonSettings(settingsPath(), (stored) => {
    const agents = object(stored.agentPreferences);
    const preference = preferences(stored, agent);
    change(preference);
    agents[agent] = preference;
    stored.agentPreferences = agents;
    if (agent === "builtin") {
      delete stored.activeModel;
      delete stored.modelPreferences;
      delete stored.providerPreferences;
    }
  });
}

export async function getAgentModelPreference(agent: string): Promise<ModelRef | undefined> {
  const active = object(preferences(await readJsonSettings(settingsPath()), agent).activeModel);
  if (!Value.Check(stringSchema, active.provider) || !Value.Check(stringSchema, active.id)) return undefined;
  return active.provider && active.id ? { provider: active.provider, id: active.id } : undefined;
}

function setThinking(preference: JsonObject, model: ModelRef, level: string): void {
  const models = object(preference.modelPreferences);
  const key = modelRefValue(model);
  models[key] = { ...object(models[key]), thinkingLevel: level };
  preference.modelPreferences = models;
}

export async function setAgentModelPreference(agent: string, model: ModelRef | undefined, thinkingLevel?: string): Promise<void> {
  await update(agent, (preference) => {
    if (model) preference.activeModel = { ...model };
    else delete preference.activeModel;
    if (model && thinkingLevel) setThinking(preference, model, thinkingLevel);
  });
}

export async function getAgentModelThinkingLevel(agent: string, model: ModelRef): Promise<string | undefined> {
  const stored = preferences(await readJsonSettings(settingsPath()), agent);
  const level = object(object(stored.modelPreferences)[modelRefValue(model)]).thinkingLevel;
  return Value.Check(stringSchema, level) ? level || undefined : undefined;
}

export async function setAgentModelThinkingLevel(agent: string, model: ModelRef, level: string): Promise<void> {
  await update(agent, (preference) => setThinking(preference, model, level));
}

export async function getAgentProviderServiceTier(agent: string, provider: string): Promise<AgentServiceTier | undefined> {
  const stored = preferences(await readJsonSettings(settingsPath()), agent);
  const preference = object(stored.providerPreferences)[provider];
  return isJsonObject(preference) ? preference.serviceTier === "priority" ? "priority" : "default" : undefined;
}

export async function setAgentProviderServiceTier(agent: string, provider: string, serviceTier: AgentServiceTier): Promise<void> {
  await update(agent, (preference) => {
    const providers = object(preference.providerPreferences);
    providers[provider] = { ...object(providers[provider]), serviceTier };
    preference.providerPreferences = providers;
  });
}
