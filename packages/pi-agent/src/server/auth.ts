import { AgentsInTheCloudCoreError } from "@agents-in-the-cloud/core";
import { hasAvailableEnabledModel } from "@agents-in-the-cloud/llm/server";

export function piModelSetupRequired(): AgentsInTheCloudCoreError {
  return new AgentsInTheCloudCoreError("agent_setup_required", "Connect a provider and choose an available enabled model before creating a Pi agent.", { setupUrl: "/models?focus=models" });
}

export async function requirePiModels(): Promise<void> {
  if (!await hasAvailableEnabledModel()) throw piModelSetupRequired();
}
