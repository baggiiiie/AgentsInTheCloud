export const compactionKeepRecentTokens = 6000;

export function contextUsagePercent(measured: number | null | undefined, estimatedTokens: number | undefined, contextWindow: number | undefined): number | null {
  return measured ?? (estimatedTokens !== undefined && contextWindow ? estimatedTokens / contextWindow * 100 : null);
}
