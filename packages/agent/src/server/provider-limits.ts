import type { AgentSession, AfterProviderResponseEvent } from "@earendil-works/pi-coding-agent";

export interface ProviderLimit {
  retryAfterMs: number;
}

/** Only explicit cooldowns on rate-limit responses are actionable; never infer quotas. */
export function providerLimit(response: Pick<AfterProviderResponseEvent, "status" | "headers">, now = Date.now()): ProviderLimit | undefined {
  if (response.status !== 429) return undefined;
  const headers = new Headers(response.headers);
  const milliseconds = headers.get("retry-after-ms")?.trim();
  if (milliseconds && /^\d+(?:\.\d+)?$/.test(milliseconds)) {
    const delay = Number(milliseconds);
    if (Number.isSafeInteger(Math.ceil(delay)) && delay >= 0) return delay > 0 ? { retryAfterMs: delay } : undefined;
  }
  const retryAfter = headers.get("retry-after")?.trim();
  if (!retryAfter) return undefined;
  const delay = /^\d+(?:\.\d+)?$/.test(retryAfter)
    ? Number(retryAfter) * 1000
    : /GMT$/.test(retryAfter) ? Date.parse(retryAfter) - now : NaN;
  return Number.isSafeInteger(Math.ceil(delay)) && delay > 0 ? { retryAfterMs: delay } : undefined;
}

/** Pi's extension hook is gated; its response callback runs without a synthetic extension. */
export function observeProviderLimits(session: AgentSession, listener: (limit: ProviderLimit | undefined) => void): () => void {
  const agent = session.agent;
  const originalResponse = agent.onResponse;
  let active = true;
  agent.onResponse = async (response, model) => {
    const limit = providerLimit(response);
    await originalResponse?.(response, model);
    if (limit || (response.status >= 200 && response.status < 300)) {
      queueMicrotask(() => { if (active) listener(limit); });
    }
  };
  return () => {
    active = false;
    agent.onResponse = originalResponse;
  };
}
