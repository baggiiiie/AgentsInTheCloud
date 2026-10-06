import { expect, test } from "bun:test";
import { forgetSubscriptionInference, recordSubscriptionInference, providersInLastInferenceWindow, selectSubscriptionLimit } from "../../src/server/recent-subscription-activity.ts";
import { usageWindowTiming } from "../../src/server/usage-window.ts";
import { supportedUsageProviders } from "../../src/server/provider-usage.ts";

const now = new Date("2026-01-01T12:00:00Z");
function window(usedPercent: number, elapsedPercent: number, durationSeconds = 3600) {
  const reported = { limitName: "Main", meteredFeature: null, kind: "primary" as const, usedPercent, durationSeconds, resetsAt: new Date(now.getTime() + (100 - elapsedPercent) / 100 * durationSeconds * 1000).toISOString() };
  return { reported, timing: usageWindowTiming(reported, now) };
}

test("always uses the 30 minutes before the last inference", () => {
  const at = now.getTime();
  forgetSubscriptionInference("anthropic");
  forgetSubscriptionInference("openai");
  expect(providersInLastInferenceWindow()).toEqual([]);
  recordSubscriptionInference("anthropic", at - 50 * 60_000);
  recordSubscriptionInference("openai", at - 25 * 60_000);
  expect(providersInLastInferenceWindow()).toEqual(["anthropic", "openai"]);
  recordSubscriptionInference("openai", at);
  expect(providersInLastInferenceWindow()).toEqual(["openai"]);
  forgetSubscriptionInference("anthropic");
  forgetSubscriptionInference("openai");
});

test("selects the subscription with the shortest estimated time to hit limit, not the highest raw usage", () => {
  const selected = selectSubscriptionLimit([
    { provider: supportedUsageProviders[0], windows: [window(90, 95)] },
    { provider: supportedUsageProviders[1], windows: [window(70, 50)] },
  ]);
  expect(selected?.provider.id).toBe("anthropic");
  expect(selectSubscriptionLimit([
    { provider: supportedUsageProviders[0], windows: [window(0, 1)] },
    { provider: supportedUsageProviders[1], windows: [window(2, 90)] },
  ])?.provider.id).toBe("anthropic");
  expect(selectSubscriptionLimit([{ provider: supportedUsageProviders[0], windows: [] }])).toBeUndefined();
});


test("compares forecast durations across providers instead of percentage leads", () => {
  const weekly = window(90, 40, 7 * 86400);
  const short = window(60, 30);
  expect(selectSubscriptionLimit([
    { provider: supportedUsageProviders[0], windows: [weekly] },
    { provider: supportedUsageProviders[1], windows: [short] },
  ])?.window).toBe(short);
});
