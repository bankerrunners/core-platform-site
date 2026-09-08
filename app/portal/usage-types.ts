export type UsageEvidence = "live" | "local" | "calculated" | "estimated" | "unavailable";
export type UsageAvailability = "available" | "unavailable" | "stale" | "error";

export type RateLimitBucket = {
  id: string;
  label: string;
  pool: string;
  usedPercent: number | null;
  remainingPercent: number | null;
  windowDurationMinutes: number | null;
  resetsAt: string | null;
  state: "ok" | "limited" | "exhausted" | "unavailable";
  spendControl: "within-plan" | "paid-credits" | "blocked" | "unavailable";
  evidence: UsageEvidence;
  unavailableReason?: string;
};

export type UsageTokenTotals = {
  inputTokens: number | null;
  outputTokens: number | null;
  cachedTokens: number | null;
  totalTokens: number | null;
  evidence: UsageEvidence;
};

export type AiUsageSnapshot = {
  schemaVersion: 1;
  availability: UsageAvailability;
  planLabel: string | null;
  buckets: RateLimitBucket[];
  resetCredits: {
    count: number | null;
    expiresAt: string | null;
    evidence: UsageEvidence;
    unavailableReason?: string;
  };
  session: null | {
    model: string | null;
    reasoningLevel: string | null;
    status: string | null;
    elapsedSeconds: number | null;
    tokens: UsageTokenTotals;
    evidence: UsageEvidence;
  };
  totals: {
    today: UsageTokenTotals;
    rollingSevenDays: UsageTokenTotals;
    currentMonth: UsageTokenTotals;
  };
  costs: Array<{
    id: "api" | "subscription" | "estimated";
    label: string;
    amountUsd: number | null;
    evidence: UsageEvidence;
    explanation: string;
  }>;
  meta: {
    source: string;
    lastRefreshedAt: string;
    staleAfterSeconds: number;
    error: string | null;
  };
};

export type UsageHistorySample = {
  capturedAt: string;
  availability: UsageAvailability;
  buckets: Array<Pick<RateLimitBucket, "id" | "usedPercent" | "remainingPercent" | "evidence">>;
};

export interface UsageSampleStore {
  readonly persistence: "session-only" | "durable";
  append(snapshot: AiUsageSnapshot): void;
  list(): readonly UsageHistorySample[];
}

