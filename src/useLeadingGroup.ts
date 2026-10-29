import { useEffect, useMemo, useState } from "react";
import type { NetworkModel } from "./core/model";
import { members } from "./core/model";
import { LEADER_SETTLE_MS, settleLeader } from "./core/leader";
import type { Leader } from "./core/leader";
import { groupBits, scoreKey } from "./core/recursion";
import type { TierScore } from "./core/recursion";

export default function useLeadingGroup(model: NetworkModel, tiers: TierScore[] | null, fresh: boolean, running: boolean) {
  const ranked = useMemo(() => (tiers ?? []).filter(group => group.tier !== "perception")
    .sort((a, b) => scoreKey(groupBits(b)) - scoreKey(groupBits(a)) || a.mask - b.mask)
    .map(group => ({
      key: JSON.stringify(members(group.mask, model.nodes.length).map(i => model.nodes[i].id).sort()),
      score: groupBits(group), group,
    })), [model, tiers]);
  const [leader, setLeader] = useState<Leader>({ key: null, challenger: null, since: 0 });
  useEffect(() => {
    if (!fresh) return;
    const next = settleLeader(leader, ranked, Date.now(), !running);
    if (next !== leader) setLeader(next);
    if (!next.challenger) return;
    const timer = setTimeout(() => setLeader(previous => settleLeader(previous, ranked, Date.now(), !running)),
      Math.max(1, next.since + LEADER_SETTLE_MS - Date.now()));
    return () => clearTimeout(timer);
  }, [ranked, fresh, running, leader]);
  const focus = (ranked.find(group => group.key === leader.key) ?? ranked[0])?.group;
  return { focus, best: ranked[0]?.group, settling: !!leader.challenger };
}
