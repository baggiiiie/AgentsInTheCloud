import { Type } from "typebox";
import { Value } from "typebox/value";
import { SubscriptionUsageError, type SubscriptionUsage } from "./subscription-usage.ts";

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

const payloadSchema = Type.Object({
  config: Type.Object({
    currentPeriod: Type.Object({ start: Type.String(), end: Type.String() }),
    creditUsagePercent: Type.Number({ minimum: 0, maximum: 100 }),
  }),
});

/** The Grok CLI's own usage panel reads this billing proxy. Not a public, versioned API.
 * Every Grok product draws from one allowance per period, so it is a single window. */
export async function fetchXaiSubscriptionUsage(accessToken: string, fetcher: Fetcher = fetch): Promise<SubscriptionUsage> {
  let response: Response;
  try {
    response = await fetcher("https://cli-chat-proxy.grok.com/v1/billing?format=credits", {
      headers: { Authorization: `Bearer ${accessToken}`, "X-XAI-Token-Auth": "xai-grok-cli", Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    });
  } catch {
    throw new SubscriptionUsageError("Could not reach xAI to check subscription usage. Try again.");
  }
  if (response.status === 401) throw new SubscriptionUsageError("xAI rejected the credentials. Reconnect xAI.");
  if (!response.ok) throw new SubscriptionUsageError(`xAI usage is unavailable (HTTP ${response.status}). Try again later.`);
  let payload: unknown;
  try { payload = await response.json(); } catch { throw new SubscriptionUsageError("xAI returned an invalid usage response."); }
  if (!Value.Check(payloadSchema, payload)) throw new SubscriptionUsageError("xAI returned an unrecognized usage response.");
  const { currentPeriod, creditUsagePercent } = payload.config;
  const start = new Date(currentPeriod.start).getTime();
  const end = new Date(currentPeriod.end).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new SubscriptionUsageError("xAI returned an unrecognized usage response.");
  return {
    plan: null,
    checkedAt: new Date().toISOString(),
    allowed: null,
    limitReached: creditUsagePercent >= 100,
    windows: [{ limitName: "Grok", meteredFeature: null, kind: "primary", usedPercent: creditUsagePercent, durationSeconds: Math.round((end - start) / 1000), resetsAt: new Date(end).toISOString() }],
  };
}
