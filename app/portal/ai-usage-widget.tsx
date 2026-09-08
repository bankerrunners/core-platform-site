"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AiUsageSnapshot,
  RateLimitBucket,
  UsageEvidence,
  UsageHistorySample,
  UsageSampleStore,
  UsageTokenTotals,
} from "./usage-types";

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const number = new Intl.NumberFormat("en-US");

class SessionUsageSampleStore implements UsageSampleStore {
  readonly persistence = "session-only" as const;
  private samples: UsageHistorySample[] = [];

  append(snapshot: AiUsageSnapshot) {
    this.samples = [
      ...this.samples,
      {
        capturedAt: snapshot.meta.lastRefreshedAt,
        availability: snapshot.availability,
        buckets: snapshot.buckets.map(({ id, usedPercent, remainingPercent, evidence }) => ({
          id,
          usedPercent,
          remainingPercent,
          evidence,
        })),
      },
    ].slice(-96);
  }

  list() {
    return this.samples;
  }
}

function evidenceLabel(value: UsageEvidence) {
  const labels: Record<UsageEvidence, string> = {
    live: "Live",
    local: "Locally accumulated",
    calculated: "Calculated",
    estimated: "Estimated",
    unavailable: "Unavailable",
  };
  return labels[value];
}

function localTime(value: string | null) {
  if (!value) return "Unavailable";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Unavailable";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

function duration(target: number | null, now: number, overdue = "Due") {
  if (target === null || !Number.isFinite(target)) return "Unavailable";
  const delta = target - now;
  if (delta <= 0) return overdue;
  const minutes = Math.ceil(delta / 60_000);
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

function tokens(value: UsageTokenTotals) {
  return value.totalTokens === null ? "Unavailable" : number.format(value.totalTokens);
}

function Bucket({ bucket, now }: { bucket: RateLimitBucket; now: number }) {
  const measurable = bucket.usedPercent !== null && bucket.remainingPercent !== null;
  return (
    <article className="ai-usage-bucket">
      <header>
        <div><strong>{bucket.label}</strong><span>{bucket.pool}</span></div>
        <span className={`ai-usage-state ai-usage-state-${bucket.state}`}>{bucket.state}</span>
      </header>
      {measurable ? (
        <>
          <div
            className="ai-usage-progress"
            role="progressbar"
            aria-label={`${bucket.label}: ${bucket.usedPercent}% used and ${bucket.remainingPercent}% remaining`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={bucket.usedPercent ?? 0}
            title="Rate limits cap activity inside a rolling or fixed time window; they are not token bills."
          >
            <span style={{ width: `${Math.min(100, Math.max(0, bucket.usedPercent ?? 0))}%` }} />
          </div>
          <p className="ai-usage-percent"><strong>{bucket.usedPercent}% used</strong><span>{bucket.remainingPercent}% remaining</span></p>
        </>
      ) : <p className="ai-usage-unavailable">{bucket.unavailableReason ?? "Usage unavailable."}</p>}
      <dl className="ai-usage-facts">
        <div><dt title="Duration covered by this rate-limit bucket.">Window</dt><dd>{bucket.windowDurationMinutes === null ? "Unavailable" : `${bucket.windowDurationMinutes / 60} hours`}</dd></div>
        <div><dt title="Provider reset shown in local time.">Reset</dt><dd>{bucket.resetsAt ? `${duration(new Date(bucket.resetsAt).getTime(), now, "Reset due")} · ${localTime(bucket.resetsAt)}` : "Unavailable"}</dd></div>
        <div><dt>Spend control</dt><dd>{bucket.spendControl}</dd></div>
        <div><dt>Evidence</dt><dd>{evidenceLabel(bucket.evidence)}</dd></div>
      </dl>
    </article>
  );
}

export function AiUsageWidget() {
  const store = useRef<UsageSampleStore>(new SessionUsageSampleStore());
  const [snapshot, setSnapshot] = useState<AiUsageSnapshot | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [visible, setVisible] = useState(true);
  const [nextRefreshAt, setNextRefreshAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    if (!navigator.onLine || document.visibilityState !== "visible") return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/portal/usage", { cache: "no-store" });
      if (!response.ok) throw new Error(`Usage read failed (${response.status})`);
      const value = (await response.json()) as AiUsageSnapshot;
      setSnapshot(value);
      store.current.append(value);
      setNextRefreshAt(Date.now() + REFRESH_INTERVAL_MS);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Usage read failed");
      setNextRefreshAt(Date.now() + REFRESH_INTERVAL_MS * 2);
    } finally {
      setNow(Date.now());
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setOnline(navigator.onLine);
    setVisible(document.visibilityState === "visible");
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const syncActivity = () => {
      const isOnline = navigator.onLine;
      const isVisible = document.visibilityState === "visible";
      setOnline(isOnline);
      setVisible(isVisible);
      if (isOnline && isVisible) void refresh();
    };
    window.addEventListener("online", syncActivity);
    window.addEventListener("offline", syncActivity);
    document.addEventListener("visibilitychange", syncActivity);
    return () => {
      window.removeEventListener("online", syncActivity);
      window.removeEventListener("offline", syncActivity);
      document.removeEventListener("visibilitychange", syncActivity);
    };
  }, [refresh]);

  useEffect(() => {
    if (!online || !visible) return;
    const interval = window.setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [online, refresh, visible]);

  useEffect(() => {
    const clock = window.setInterval(() => setNow(Date.now()), 30_000);
    const close = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", close);
    return () => {
      window.clearInterval(clock);
      window.removeEventListener("keydown", close);
    };
  }, []);

  const freshestBucket = useMemo(() => {
    const measured = snapshot?.buckets.filter((bucket) => bucket.remainingPercent !== null) ?? [];
    return measured.sort((a, b) => (a.remainingPercent ?? 101) - (b.remainingPercent ?? 101))[0] ?? null;
  }, [snapshot]);
  const lastSuccess = snapshot ? new Date(snapshot.meta.lastRefreshedAt).getTime() : null;
  const staleAge = lastSuccess === null ? "No successful refresh" : duration(now, lastSuccess, `${Math.max(0, Math.floor((now - lastSuccess) / 60_000))}m old`);
  const sourceState = !online ? "Offline" : !visible ? "Paused while hidden" : error ? "Error" : loading ? "Refreshing" : snapshot?.availability ?? "Unavailable";

  return (
    <aside className={`ai-usage-widget${open ? " ai-usage-widget-open" : ""}`} aria-label="AI usage tracker">
      <button className="ai-usage-trigger" type="button" aria-expanded={open} aria-controls="ai-usage-drawer" onClick={() => setOpen((value) => !value)}>
        <span className="ai-usage-mark" aria-hidden="true">AI</span>
        <span><strong>AI Usage</strong><small>{freshestBucket ? `${freshestBucket.remainingPercent}% remaining` : sourceState}</small></span>
        <span className="ai-usage-live" aria-hidden="true" />
      </button>
      {open ? (
        <div className="ai-usage-drawer" id="ai-usage-drawer" role="dialog" aria-modal="false" aria-labelledby="ai-usage-title">
          <header className="ai-usage-head">
            <div><p className="portal-eyebrow">Constant read-only tracker</p><h2 id="ai-usage-title">AI Usage</h2><span>{snapshot?.planLabel ?? "Plan unavailable"}</span></div>
            <div><button type="button" onClick={() => void refresh()} disabled={loading || !online || !visible}>{loading ? "Refreshing…" : "Refresh"}</button><button type="button" aria-label="Close AI usage" onClick={() => setOpen(false)}>×</button></div>
          </header>
          <div className="ai-usage-refresh-state" aria-live="polite">
            <span><b>State</b> {sourceState}</span>
            <span><b>Last success</b> {snapshot ? localTime(snapshot.meta.lastRefreshedAt) : "None"}</span>
            <span><b>Stale age</b> {staleAge}</span>
            <span><b>Next refresh</b> {online && visible ? duration(nextRefreshAt, now) : "Paused"}</span>
          </div>
          {error ? <p className="ai-usage-error" role="alert">{error}</p> : null}
          {snapshot?.availability === "unavailable" ? <div className="ai-usage-callout"><strong>Live telemetry is not connected.</strong><p>The Cloudflare portal cannot call the signed-in desktop Codex host. Values stay unavailable instead of being scraped or guessed.</p></div> : null}
          <section><h3>Rate-limit buckets</h3>{snapshot?.buckets.length ? <div className="ai-usage-buckets">{snapshot.buckets.map((bucket) => <Bucket key={bucket.id} bucket={bucket} now={now} />)}</div> : <p className="ai-usage-unavailable">No rate-limit buckets are available from the current provider.</p>}</section>
          <section className="ai-usage-card-grid" aria-label="Credits and current task">
            <article><h3 title="Reset credits restore eligible usage. This widget never redeems them.">Reset credits</h3><strong>{snapshot?.resetCredits.count ?? "Unavailable"}</strong><p>{snapshot?.resetCredits.expiresAt ? `Expires ${localTime(snapshot.resetCredits.expiresAt)}` : "Expiration unavailable"}</p><small>Read-only · never redeemed automatically</small></article>
            <article><h3>Current task</h3><strong>{snapshot?.session ? tokens(snapshot.session.tokens) : "Unavailable"}</strong><p>{snapshot?.session?.model ?? "Model unavailable"} · {snapshot?.session?.reasoningLevel ?? "Reasoning unavailable"}</p><small>{snapshot?.session?.status ?? "Status unavailable"}</small></article>
          </section>
          <section><h3 title="Tokens are measured model input, output, and cache activity—not characters or dollars.">Token history</h3><div className="ai-usage-history"><span><small>Today</small><strong>{snapshot ? tokens(snapshot.totals.today) : "Unavailable"}</strong></span><span><small>Rolling 7 days</small><strong>{snapshot ? tokens(snapshot.totals.rollingSevenDays) : "Unavailable"}</strong></span><span><small>Current month</small><strong>{snapshot ? tokens(snapshot.totals.currentMonth) : "Unavailable"}</strong></span></div><p className="ai-usage-storage">History: {store.current.persistence === "session-only" ? "session-only fallback; nothing persists after the app closes" : "durable approved store"} · {store.current.list().length} samples this session.</p></section>
          <section><h3>Cost semantics</h3><div className="ai-usage-costs">{snapshot?.costs.map((cost) => <article key={cost.id}><span>{cost.label}</span><strong>{cost.amountUsd === null ? "Unavailable" : `$${cost.amountUsd.toFixed(2)}`}</strong><p>{cost.explanation}</p><small>{evidenceLabel(cost.evidence)}</small></article>)}</div></section>
          <footer className="ai-usage-meta"><span>Source: {snapshot?.meta.source ?? "Not loaded"}</span><span>Auto-refresh: 5 minutes while visible and online</span><span>No monitoring while the app is closed</span></footer>
        </div>
      ) : null}
    </aside>
  );
}
