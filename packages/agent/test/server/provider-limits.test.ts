import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { createAgentSession, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { observeProviderLimits, providerLimit, type ProviderLimit } from "../../src/server/provider-limits.ts";
import { createAtelierResourceLoader } from "../../src/server/system-prompt.ts";

test("rate-limit cooldowns require explicit, valid response metadata", () => {
  const now = Date.UTC(2020, 0, 1);
  const response = (headers: Record<string, string>, status = 429) => ({ status, headers });
  expect(providerLimit(response({ "Retry-After": "12" }), now)).toEqual({ retryAfterMs: 12000 });
  expect(providerLimit(response({ "retry-after": " 0.25 " }), now)).toEqual({ retryAfterMs: 250 });
  expect(providerLimit(response({ "retry-after": "Wed, 01 Jan 2020 00:00:10 GMT" }), now)).toEqual({ retryAfterMs: 10000 });
  expect(providerLimit(response({ "retry-after-ms": "1250", "retry-after": "10" }), now)).toEqual({ retryAfterMs: 1250 });
  expect(providerLimit(response({ "retry-after-ms": "bad", "retry-after": "10" }), now)).toEqual({ retryAfterMs: 10000 });
  expect(providerLimit(response({ "retry-after-ms": "0", "retry-after": "10" }), now)).toBeUndefined();
  for (const value of ["", "bad", "-1", "0", "Infinity", "1sec", "03/04/2027", "1e100", "9999999999999999999999999999", "Tue, 31 Dec 2019 23:59:59 GMT"]) {
    expect(providerLimit(response({ "retry-after": value }), now)).toBeUndefined();
  }
  expect(providerLimit(response({}), now)).toBeUndefined();
  expect(providerLimit(response({ "retry-after": "10" }, 200), now)).toBeUndefined();
  expect(providerLimit(response({ "retry-after": "10" }, 503), now)).toBeUndefined();
});

test("response observation preserves Pi callbacks, clears on success, and unsubscribes pending work", async () => {
  const dir = await mkdtemp(join(tmpdir(), "atelier-provider-limit-"));
  const { session } = await createAgentSession({
    cwd: dir, agentDir: dir, resourceLoader: createAtelierResourceLoader(),
    sessionManager: SessionManager.inMemory(dir), settingsManager: SettingsManager.inMemory(), tools: [],
  });
  const responses: number[] = [];
  let pending: Promise<void> | undefined;
  session.agent.onResponse = async response => { responses.push(response.status); await pending; };
  const original = session.agent.onResponse;
  const limits: Array<ProviderLimit | undefined> = [];
  const detach = observeProviderLimits(session, limit => limits.push(limit));
  const model = session.agent.state.model;
  try {
    expect(session.hasExtensionHandlers("after_provider_response")).toBe(false);
    await session.agent.onResponse!({ status: 429, headers: { "retry-after": "12" } }, model);
    await session.agent.onResponse!({ status: 429, headers: {} }, model);
    await session.agent.onResponse!({ status: 503, headers: { "retry-after": "20" } }, model);
    await session.agent.onResponse!({ status: 200, headers: {} }, model);
    expect(limits).toEqual([{ retryAfterMs: 12000 }, undefined]);
    expect(responses).toEqual([429, 429, 503, 200]);
    const delayed = Promise.withResolvers<void>();
    pending = delayed.promise;
    const response = session.agent.onResponse!({ status: 429, headers: { "retry-after": "12" } }, model);
    detach();
    expect(session.agent.onResponse).toBe(original);
    delayed.resolve();
    await response;
    expect(limits).toHaveLength(2);
  } finally {
    detach();
    session.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});
