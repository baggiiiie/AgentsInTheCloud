import { Type } from "typebox";
import { fetchSubscriptionUsageJson, subscriptionUsageMessages, SubscriptionUsageError, type Fetcher, type SubscriptionUsage } from "./subscription-usage.ts";

const payloadSchema = Type.Object({
  config: Type.Object({
    currentPeriod: Type.Object({ start: Type.String(), end: Type.String() }),
    creditUsagePercent: Type.Number({ minimum: 0, maximum: 100 }),
  }),
});

/** The Grok CLI's own usage panel reads this billing proxy. Not a public, versioned API.
 * Every Grok product draws from one allowance per period, so it is a single window. */
export async function fetchXaiSubscriptionUsage(accessToken: string, fetcher: Fetcher = fetch): Promise<SubscriptionUsage> {
  const messages = subscriptionUsageMessages("xAI");
  const payload = await fetchSubscriptionUsageJson("https://cli-chat-proxy.grok.com/v1/billing?format=credits", {
    headers: { Authorization: `Bearer ${accessToken}`, "X-XAI-Token-Auth": "xai-grok-cli", Accept: "application/json" },
  }, payloadSchema, messages, fetcher);
  const { currentPeriod, creditUsagePercent } = payload.config;
  const start = new Date(currentPeriod.start).getTime();
  const end = new Date(currentPeriod.end).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new SubscriptionUsageError(messages.unrecognized);
  return {
    plan: null,
    checkedAt: new Date().toISOString(),
    allowed: null,
    limitReached: creditUsagePercent >= 100,
    windows: [{ limitName: "Grok", meteredFeature: null, kind: "primary", usedPercent: creditUsagePercent, durationSeconds: Math.round((end - start) / 1000), resetsAt: new Date(end).toISOString() }],
  };
}
