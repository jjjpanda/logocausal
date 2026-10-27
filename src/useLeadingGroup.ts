import { useEffect, useMemo, useRef, useState } from "react";
import type { NetworkModel } from "./core/model";
import { members, remapState } from "./core/model";
import { LEADER_SETTLE_MS, settleLeader } from "./core/leader";
import type { Leader } from "./core/leader";
import { groupBits, rankGroups } from "./core/recursion";
import type { TierScore } from "./core/recursion";

export default function useLeadingGroup(model: NetworkModel, tiers: TierScore[] | null, fresh: boolean, running: boolean, generation: number) {
  const ranked = useMemo(() => rankGroups(tiers ?? []).map(group => ({
      key: `${generation}:${JSON.stringify(members(group.mask, model.nodes.length).map(i => model.nodes[i].id).sort())}`,
      score: groupBits(group), group,
    })), [model, tiers, generation]);
  const [leader, setLeader] = useState<Leader>({ key: null, challenger: null, since: 0, selectedAt: 0 });
  const previous = useRef<{ model: NetworkModel; group: TierScore; generation: number } | null>(null);
  const retained = useMemo(() => {
    if (!previous.current || !leader.key || previous.current.generation !== generation) return undefined;
    const { model: old, group } = previous.current;
    const mask = remapState(group.mask, old, model);
    // Membership changes (death or a new population) invalidate the old selection.
    if (members(mask, model.nodes.length).length !== members(group.mask, old.nodes.length).length) return undefined;
    return { ...group, mask, model: remapState(group.model, old, model), record: remapState(group.record, old, model) };
  }, [model, leader, generation]);
  useEffect(() => {
    if (!fresh) return;
    const next = settleLeader(leader, ranked, Date.now(), !running || (!!leader.key && !retained));
    if (next !== leader) setLeader(next);
    const missing = !!next.key && !ranked.some(group => group.key === next.key);
    if (!next.challenger && !missing) return;
    const timer = setTimeout(() => setLeader(previous => settleLeader(previous, ranked, Date.now(), !running)),
      Math.max(1, (missing ? next.selectedAt : next.since) + LEADER_SETTLE_MS - Date.now()));
    return () => clearTimeout(timer);
  }, [ranked, fresh, running, leader, retained]);
  const rankedFocus = ranked.find(group => group.key === leader.key)?.group;
  const focus = !running && fresh ? ranked[0]?.group : rankedFocus ?? retained ?? ranked[0]?.group;
  useEffect(() => {
    if (focus) previous.current = { model, group: focus, generation };
    else previous.current = null;
  }, [model, focus, generation]);
  return { focus, scored: fresh && !!rankedFocus };
}
