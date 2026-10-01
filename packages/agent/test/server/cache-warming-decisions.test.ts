import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { createAgentSession, SessionManager, SettingsManager, type CacheWarmingDecisionEvent } from "@earendil-works/pi-coding-agent";
import { observeCacheWarmingDecisions, type CacheWarmingDecisionOutcome } from "../../src/server/cache-warming-decisions.ts";
import { createAtelierResourceLoader } from "../../src/server/system-prompt.ts";

test("warming observation preserves final policy actions, overrides, and subscription lifetime", async () => {
  const dir = await mkdtemp(join(tmpdir(), "atelier-warming-observer-"));
  const { session } = await createAgentSession({
    cwd: dir, agentDir: dir, resourceLoader: createAtelierResourceLoader(),
    sessionManager: SessionManager.inMemory(dir), settingsManager: SettingsManager.inMemory(), tools: [],
  });
  const runner = session.extensionRunner;
  const dispatch = runner.emitCacheWarmingDecision.bind(runner);
  let override: CacheWarmingDecisionEvent["action"] | undefined;
  runner.emitCacheWarmingDecision = event => override === undefined ? dispatch(event) : Promise.resolve(override);
  const original = runner.emitCacheWarmingDecision;
  const outcomes: CacheWarmingDecisionOutcome[] = [];
  let detach = observeCacheWarmingDecisions(session, outcome => outcomes.push(outcome));
  const event = (action: CacheWarmingDecisionEvent["action"]): CacheWarmingDecisionEvent => ({
    type: "cache_warming_decision", action, warmCost: 0.03, missCost: 0.2, continuationProbability: 1,
  });
  try {
    expect(await runner.emitCacheWarmingDecision(event("stop"))).toBe("stop");
    expect(await runner.emitCacheWarmingDecision(event("warm"))).toBe("warm");
    override = "stop";
    expect(await runner.emitCacheWarmingDecision(event("warm"))).toBe("stop");
    override = "warm";
    expect(await runner.emitCacheWarmingDecision(event("stop"))).toBe("warm");
    expect(outcomes).toEqual([
      { action: "stop", overridden: false, economicsAvailable: undefined },
      { action: "warm", overridden: false, economicsAvailable: undefined },
      { action: "stop", overridden: true, economicsAvailable: undefined },
      { action: "warm", overridden: true, economicsAvailable: undefined },
    ]);
    detach();
    expect(runner.emitCacheWarmingDecision).toBe(original);
    await runner.emitCacheWarmingDecision(event("warm"));
    expect(outcomes).toHaveLength(4);

    const pending = Promise.withResolvers<CacheWarmingDecisionEvent["action"]>();
    runner.emitCacheWarmingDecision = () => pending.promise;
    detach = observeCacheWarmingDecisions(session, outcome => outcomes.push(outcome));
    const decision = runner.emitCacheWarmingDecision(event("warm"));
    detach();
    pending.resolve("stop");
    expect(await decision).toBe("stop");
    expect(outcomes).toHaveLength(4);
  } finally {
    detach();
    session.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});
