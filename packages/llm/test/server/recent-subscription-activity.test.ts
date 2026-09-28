import { expect, test } from "bun:test";
import { forgetSubscriptionInference, recordSubscriptionInference, providersInLastInferenceWindow, selectSubscriptionLimit } from "../../src/server/recent-subscription-activity.ts";
import { usageWindowTiming } from "../../src/server/usage-window.ts";
import { supportedUsageProviders } from "../../src/server/provider-usage.ts";

const now = new Date("2026-01-01T12:00:00Z");
function window(usedPercent: number, elapsedPercent: number) {
  const reported = { limitName: "Main", meteredFeature: null, kind: "primary" as const, usedPercent, durationSeconds: 3600, resetsAt: new Date(now.getTime() + (100 - elapsedPercent) * 36_000).toISOString() };
  return { reported, timing: usageWindowTiming(reported, now) };
}

test("always uses the 30 minutes before the last inference", () => {
  const at = now.getTime();
  forgetSubscriptionInference("anthropic");
  forgetSubscriptionInference("openai-codex");
  expect(providersInLastInferenceWindow()).toEqual([]);
  recordSubscriptionInference("anthropic", at - 50 * 60_000);
  recordSubscriptionInference("openai-codex", at - 25 * 60_000);
  expect(providersInLastInferenceWindow()).toEqual(["anthropic", "openai-codex"]);
  recordSubscriptionInference("openai-codex", at);
  expect(providersInLastInferenceWindow()).toEqual(["openai-codex"]);
  forgetSubscriptionInference("anthropic");
  forgetSubscriptionInference("openai-codex");
});

test("selects the subscription furthest ahead of pace, not the highest raw usage", () => {
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
