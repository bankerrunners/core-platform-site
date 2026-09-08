import type { AiUsageSnapshot, UsageTokenTotals } from "./usage-types";

export interface AiUsageProvider {
  readonly name: string;
  read(): Promise<AiUsageSnapshot>;
}

const unavailableTotals = (): UsageTokenTotals => ({
  inputTokens: null,
  outputTokens: null,
  cachedTokens: null,
  totalTokens: null,
  evidence: "unavailable",
});

/**
 * Cloudflare cannot call the signed-in desktop Codex host's private usage API.
 * This adapter says so explicitly: no UI scraping, guessed counters, secrets,
 * or raw account identifiers. A trusted bridge can later implement the same
 * interface without changing the authenticated route or client widget.
 */
class UnavailableCodexHostProvider implements AiUsageProvider {
  readonly name = "Codex host bridge (not connected)";

  async read(): Promise<AiUsageSnapshot> {
    return {
      schemaVersion: 1,
      availability: "unavailable",
      planLabel: null,
      buckets: [],
      resetCredits: {
        count: null,
        expiresAt: null,
        evidence: "unavailable",
        unavailableReason: "The web runtime has no authenticated Codex host usage bridge.",
      },
      session: null,
      totals: {
        today: unavailableTotals(),
        rollingSevenDays: unavailableTotals(),
        currentMonth: unavailableTotals(),
      },
      costs: [
        {
          id: "api",
          label: "API cost",
          amountUsd: null,
          evidence: "unavailable",
          explanation: "No verified API billing source or measured token ledger is connected.",
        },
        {
          id: "subscription",
          label: "ChatGPT / Codex subscription",
          amountUsd: null,
          evidence: "unavailable",
          explanation: "Included in plan / no per-token bill exposed.",
        },
        {
          id: "estimated",
          label: "Estimated cost",
          amountUsd: null,
          evidence: "unavailable",
          explanation: "An estimate requires measured token classes and verified model pricing.",
        },
      ],
      meta: {
        source: this.name,
        lastRefreshedAt: new Date().toISOString(),
        staleAfterSeconds: 600,
        error: null,
      },
    };
  }
}

export function getAiUsageProvider(): AiUsageProvider {
  return new UnavailableCodexHostProvider();
}

