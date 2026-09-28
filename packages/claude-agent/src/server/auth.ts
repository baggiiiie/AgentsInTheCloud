import { AtelierCoreError } from "@atelier/core";
import { createPiModelRuntime, usesAnthropicSubscription } from "@atelier/llm/server";

export const claudeSubscriptionSetupUrl = "/settings/models/step?provider=anthropic";

export async function requireClaudeSubscription(): Promise<void> {
  if (!await usesAnthropicSubscription(await createPiModelRuntime())) {
    throw new AtelierCoreError("agent_setup_required", "Connect a Claude subscription before creating a Claude agent.", { setupUrl: claudeSubscriptionSetupUrl });
  }
}
