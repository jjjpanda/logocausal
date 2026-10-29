export const LEADER_SETTLE_MS = 2000;

export interface RankedGroup { key: string; score: number }
export interface Leader {
  key: string | null;
  challenger: string | null;
  since: number;
}

/** Presentation hysteresis only; the underlying scores are always current. */
export function settleLeader(previous: Leader, ranked: RankedGroup[], now: number, immediate = false): Leader {
  const best = ranked[0];
  const current = ranked.find(group => group.key === previous.key);
  const select = (key: string | null): Leader => previous.key === key && !previous.challenger
    ? previous : { key, challenger: null, since: 0 };
  if (!best || !current || immediate) return select(best?.key ?? null);
  const margin = Math.max(0.05, current.score * 0.1);
  if (best.key === current.key || best.score - current.score < margin - 1e-9) return select(current.key);
  if (previous.challenger !== best.key) return { key: current.key, challenger: best.key, since: now };
  return now - previous.since >= LEADER_SETTLE_MS ? select(best.key) : previous;
}
