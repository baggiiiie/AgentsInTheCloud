import { AtelierCoreError } from "@atelier/core";
import { createPiModelRuntime } from "@atelier/llm/server";

export const codexSubscriptionSetupUrl = "/settings/models/step?provider=openai";

export async function requireCodexSubscription(): Promise<void> {
  const credentials = await (await createPiModelRuntime()).listCredentials();
  if (!credentials.some((credential) => credential.providerId === "openai" && credential.type === "oauth")) {
    throw new AtelierCoreError("agent_setup_required", "Connect a Codex subscription before creating a Codex agent.", { setupUrl: codexSubscriptionSetupUrl });
  }
}
