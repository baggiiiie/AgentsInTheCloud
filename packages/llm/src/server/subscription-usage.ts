export type SubscriptionUsage = {
  plan: string | null;
  checkedAt: string;
  allowed: boolean | null;
  limitReached: boolean | null;
  windows: { limitName: string; meteredFeature: string | null; kind: "primary" | "secondary"; usedPercent: number; durationSeconds: number; resetsAt: string | null }[];
};

/** Expected provider/authentication failures that can be shown in the usage overview. */
export class SubscriptionUsageError extends Error {
  /** Seconds the provider asked us to wait before asking again, when it said. */
  constructor(message: string, readonly retryAfterSeconds: number | null = null) { super(message); }
}
