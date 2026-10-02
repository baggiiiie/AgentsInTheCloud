import { expect, test } from "bun:test";
import { fetchXaiSubscriptionUsage } from "../../src/server/xai-subscription-usage.ts";

function billing(creditUsagePercent: number) {
  return {
    config: {
      currentPeriod: { type: "USAGE_PERIOD_TYPE_WEEKLY", start: "2026-09-30T03:16:28.997216+00:00", end: "2026-10-07T03:16:28.997216+00:00" },
      creditUsagePercent,
      productUsage: [{ product: "GrokBuild", usagePercent: creditUsagePercent }],
      prepaidBalance: { val: 0 },
    },
  };
}

test("xAI's shared allowance is one window for the billing period", async () => {
  const usage = await fetchXaiSubscriptionUsage("token", async (url, init) => {
    expect(url).toBe("https://cli-chat-proxy.grok.com/v1/billing?format=credits");
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe("Bearer token");
    expect(headers.get("x-xai-token-auth")).toBe("xai-grok-cli");
    return Response.json(billing(11));
  });
  expect(usage.limitReached).toBe(false);
  expect(usage.windows).toEqual([{ limitName: "Grok", meteredFeature: null, kind: "primary", usedPercent: 11, durationSeconds: 7 * 86400, resetsAt: "2026-10-07T03:16:28.997Z" }]);
});

test("a spent xAI allowance is reported as reached", async () => {
  expect((await fetchXaiSubscriptionUsage("token", async () => Response.json(billing(100)))).limitReached).toBe(true);
});

test("rejected xAI credentials ask for a reconnect", async () => {
  await expect(fetchXaiSubscriptionUsage("token", async () => new Response("", { status: 401 }))).rejects.toThrow("Reconnect xAI");
});

test("unrecognized xAI billing responses are errors", async () => {
  await expect(fetchXaiSubscriptionUsage("token", async () => Response.json({ config: {} }))).rejects.toThrow("unrecognized");
});
