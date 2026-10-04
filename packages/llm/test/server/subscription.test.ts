import { expect, test } from "bun:test";
import type { CredentialInfo } from "@earendil-works/pi-ai";
import { requireProviderSubscription } from "../../src/server/subscription.ts";

const runtime = (credentials: CredentialInfo[]) => ({ listCredentials: async () => credentials });

test("requires that provider's subscription, not an API key or another provider's OAuth", async () => {
  for (const provider of ["anthropic", "openai"]) {
    for (const credentials of [[], [{ providerId: provider, type: "api_key" }], [{ providerId: "openai-codex", type: "oauth" }]] satisfies CredentialInfo[][]) {
      await expect(requireProviderSubscription(runtime(credentials), provider, "Agent")).rejects.toMatchObject({
        code: "agent_setup_required",
        details: { setupUrl: `/models?connect=${provider}` },
      });
    }
    await requireProviderSubscription(runtime([{ providerId: provider, type: "oauth" }]), provider, "Agent");
  }
});
