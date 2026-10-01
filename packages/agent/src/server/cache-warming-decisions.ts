import type { AgentSession, CacheWarmingDecisionEvent } from "@earendil-works/pi-coding-agent";

export interface CacheWarmingDecisionOutcome {
  action: CacheWarmingDecisionEvent["action"];
  overridden: boolean;
  economicsAvailable: boolean | undefined;
}

/** Observe the final action without taking part in Pi's warming policy. */
export function observeCacheWarmingDecisions(session: AgentSession, listener: (outcome: CacheWarmingDecisionOutcome) => void): () => void {
  const runner = session.extensionRunner;
  const originalDecide = runner.emitCacheWarmingDecision;
  let active = true;
  runner.emitCacheWarmingDecision = async event => {
    const proposedAction = event.action;
    const economicsAvailable = session.cacheWarmingStatus?.decision?.economicsAvailable;
    const action = await originalDecide.call(runner, event);
    // Presentation must not change the policy result if a subscriber throws.
    queueMicrotask(() => {
      if (active) listener({ action, overridden: action !== proposedAction, economicsAvailable });
    });
    return action;
  };
  return () => {
    active = false;
    runner.emitCacheWarmingDecision = originalDecide;
  };
}
