export const LEADER_SETTLE_MS = 2000;

export interface RankedGroup { key: string; score: number }
export interface Leader {
  key: string | null;
  challenger: string | null;
  since: number;
  selectedAt: number;
}

/** Presentation hysteresis only; the underlying scores are always current. */
export function settleLeader(previous: Leader, ranked: RankedGroup[], now: number, immediate = false): Leader {
  const best = ranked[0];
  const current = ranked.find(group => group.key === previous.key);
  const select = (key: string | null): Leader => previous.key === key && !previous.challenger
    ? previous : { key, challenger: null, since: 0, selectedAt: previous.key === key ? previous.selectedAt : now };
  if (immediate || !previous.key) return select(best?.key ?? null);
  // A disappearing ranking entry can still have living members. Give its last
  // result a full reading interval instead of rapidly cycling through fallbacks.
  if (!current) {
    if (now - previous.selectedAt >= LEADER_SETTLE_MS) return select(best?.key ?? null);
    return previous.challenger === (best?.key ?? null) ? previous
      : { ...previous, challenger: best?.key ?? null, since: previous.selectedAt };
  }
  if (!best) return select(null);
  const margin = Math.max(0.05, current.score * 0.1);
  if (best.key === current.key || best.score - current.score < margin - 1e-9) return select(current.key);
  if (previous.challenger !== best.key) return { ...previous, challenger: best.key, since: now };
  return now - previous.since >= LEADER_SETTLE_MS ? select(best.key) : previous;
}
