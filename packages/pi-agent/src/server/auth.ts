import { AgentsInTheCloudCoreError } from "@agents-in-the-cloud/core";
import { hasAvailableConfiguredModel } from "@agents-in-the-cloud/llm/server";

export function piModelSetupRequired(): AgentsInTheCloudCoreError {
  return new AgentsInTheCloudCoreError("agent_setup_required", "Connect a provider and choose an available favorite model before creating a Pi agent.", { setupUrl: "/models?focus=models" });
}

export async function requirePiModels(): Promise<void> {
  if (!await hasAvailableConfiguredModel()) throw piModelSetupRequired();
}
