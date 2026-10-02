import { Type } from "typebox";
import { Value } from "typebox/value";
import { SubscriptionUsageError, type SubscriptionUsage } from "./subscription-usage.ts";

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

const payloadSchema = Type.Object({
  currency: Type.String({ minLength: 1 }),
  balance: Type.Object({ available: Type.Number() }),
  current_period: Type.Object({ ends_at: Type.String(), actual_charged: Type.Number({ minimum: 0 }) }),
});

/** Radius bills prepaid organization credits, so it reports a balance rather than allowance windows. */
export async function fetchRadiusUsage(accessToken: string, fetcher: Fetcher = fetch): Promise<SubscriptionUsage> {
  let response: Response;
  try {
    response = await fetcher("https://radius.pi.dev/v1/billing", {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    });
  } catch {
    throw new SubscriptionUsageError("Could not reach Radius to check credits. Try again.");
  }
  if (response.status === 401) throw new SubscriptionUsageError("Radius rejected the credentials. Reconnect Radius.");
  if (!response.ok) throw new SubscriptionUsageError(`Radius credits are unavailable (HTTP ${response.status}). Try again later.`);
  let payload: unknown;
  try { payload = await response.json(); } catch { throw new SubscriptionUsageError("Radius returned an invalid billing response."); }
  if (!Value.Check(payloadSchema, payload)) throw new SubscriptionUsageError("Radius returned an unrecognized billing response.");
  return {
    plan: null,
    checkedAt: new Date().toISOString(),
    allowed: null,
    limitReached: null,
    windows: [],
    balance: { currency: payload.currency, available: payload.balance.available, monthSpend: payload.current_period.actual_charged },
  };
}
