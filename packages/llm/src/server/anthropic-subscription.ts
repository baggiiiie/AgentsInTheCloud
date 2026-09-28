import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

export const anthropicSubscriptionNotice = {
  title: "You can use your Anthropic subscription in Atelier.",
  message: "Make sure to select Claude Code as agent. Anthropic does not allow you to use our other agents with their subscription.",
};
/** Short form for pickers and errors where a model cannot use the subscription. */
export const anthropicSubscriptionUnavailableReason = "Anthropic does not allow you to use our other agents with their subscription. Select Claude Code as agent.";

/** Pi stores one credential per provider, so an OAuth credential means Anthropic is connected only through a subscription. */
export async function usesAnthropicSubscription(runtime: Pick<ModelRuntime, "listCredentials">): Promise<boolean> {
  return (await runtime.listCredentials()).some((credential) => credential.providerId === "anthropic" && credential.type === "oauth");
}
