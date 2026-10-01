import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { hasAvailableBuiltinAgentModel } from "@atelier/agent/server";
import { atelierDataPath, getAtelierRuntimeContext, invalidArguments, type AtelierEventBus } from "@atelier/core";
import { createPiModelRuntime, usesProviderSubscription } from "@atelier/llm/server";
import type { WorkspaceAgentProvider } from "@atelier/shared";
import { workspaceModules } from "./workspace-modules.generated.ts";

export function registeredAgentProviders(): readonly WorkspaceAgentProvider[] { return workspaceModules.flatMap((module) => module.agentProvider ? [module.agentProvider] : []); }

export function agentProvider(id: string): WorkspaceAgentProvider {
  const provider = registeredAgentProviders().find((provider) => provider.id === id);
  if (!provider) throw invalidArguments(`Unknown agent provider: ${id}`);
  return provider;
}

function preferencePath() {
  return atelierDataPath(getAtelierRuntimeContext(), "default-agent-provider.json");
}

export async function defaultAgentProvider(): Promise<WorkspaceAgentProvider> {
  let id: unknown;
  try {
    id = JSON.parse(await readFile(preferencePath(), "utf8"));
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  const provider = registeredAgentProviders().find((provider) => provider.id === id) ?? agentProvider("builtin");
  // Anthropic subscriptions work only in Claude Code; without another usable model, the built-in agent could not start.
  if (provider.id === "builtin" && !await hasAvailableBuiltinAgentModel() && await usesProviderSubscription(await createPiModelRuntime(), "anthropic")) return agentProvider("claude");
  return provider;
}

export async function rememberAgentProvider(id: string, events?: AtelierEventBus): Promise<void> {
  agentProvider(id);
  const path = preferencePath();
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(id)}\n`);
  await rename(temporary, path);
  await events?.emit("agent_provider_default_changed", { providerId: id });
}

export async function orderedAgentProviders(): Promise<readonly WorkspaceAgentProvider[]> {
  const preferred = await defaultAgentProvider();
  return [preferred, ...registeredAgentProviders().filter((provider) => provider.id !== preferred.id)];
}
