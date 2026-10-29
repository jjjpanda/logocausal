import { groupInfo } from "./info";
import { members, popcount, validateModel } from "./model";
import type { NetworkModel } from "./model";

export type Tier = "perception" | "awareness" | "consciousness";

export interface TierScore {
  mask: number;
  size: number;
  /** I(S_t; S_{t+1}): how much the group's past fixes its own future. */
  awareness: number;
  /** Best split (model, record): max over splits of min(I(M_t; R_{t+1}), I(R_t; M_{t+1})). */
  loop: number;
  model: number;
  record: number;
  modelToRecord: number;
  recordToModel: number;
  tier: Tier;
}

export const MAX_GROUP = 5;

export const scoreKey = (score: number): number => Math.round(score * 1e9);

export const groupBits = (group: TierScore): number => group.tier === "consciousness" ? group.loop : group.awareness;

/** Highest displayed information score, with a stable tie-break by membership mask. */
export function highestGroup(tiers: TierScore[]): TierScore | undefined {
  return tiers.filter(s => s.tier !== "perception").reduce<TierScore | undefined>((best, s) =>
    !best || scoreKey(groupBits(s)) > scoreKey(groupBits(best)) ||
    (scoreKey(groupBits(s)) === scoreKey(groupBits(best)) && s.mask < best.mask) ? s : best, undefined);
}

/** Anchor the least significant member in A so each unordered bipartition appears once. */
function bipartitions(mask: number): [number, number][] {
  const anchor = mask & -mask;
  const pairs: [number, number][] = [];
  for (let a = (mask - 1) & mask; a > 0; a = (a - 1) & mask)
    if (a & anchor) pairs.push([a, mask ^ a]);
  return pairs;
}

/** Groups of up to MAX_GROUP neurons joined by read-links. Unlinked neurons never form a group. */
function linkedGroups(model: NetworkModel): number[] {
  const n = model.nodes.length;
  const near = model.nodes.map(() => 0);
  model.nodes.forEach((node, j) =>
    node.inputs.forEach((i) => {
      near[i] |= 1 << j;
      near[j] |= 1 << i;
    }),
  );
  let level = new Set(model.nodes.map((_, i) => 1 << i));
  const groups = [...level];
  for (let size = 2; size <= Math.min(MAX_GROUP, n); size++) {
    const next = new Set<number>();
    for (const mask of level) {
      const edge = members(mask, n).reduce((bits, i) => bits | near[i], 0) & ~mask;
      for (const i of members(edge, n)) next.add(mask | (1 << i));
    }
    groups.push(...next);
    level = next;
  }
  return groups;
}

function score(model: NetworkModel, mask: number): TierScore {
  const n = model.nodes.length;
  const group = members(mask, n);
  const awareness = groupInfo(model, group, group);
  const best = { loop: 0, model: 0, record: 0, modelToRecord: 0, recordToModel: 0 };
  if (scoreKey(awareness) > 0)
    for (const [a, b] of bipartitions(mask)) {
      const modelToRecord = groupInfo(model, members(a, n), members(b, n));
      const recordToModel = groupInfo(model, members(b, n), members(a, n));
      const loop = Math.min(modelToRecord, recordToModel);
      if (scoreKey(loop) > scoreKey(best.loop))
        Object.assign(best, { loop, model: a, record: b, modelToRecord, recordToModel });
    }
  return {
    mask,
    size: popcount(mask),
    awareness,
    ...best,
    tier:
      scoreKey(best.loop) > 0 ? "consciousness" : scoreKey(awareness) > 0 ? "awareness" : "perception",
  };
}

/** Every linked group that holds no smaller loop, strongest loop first. So each loop is minimal. */
export function analyze(model: NetworkModel): TierScore[] {
  validateModel(model);
  const loops: number[] = [];
  const scores: TierScore[] = [];
  for (const mask of linkedGroups(model)) {
    if (loops.some((loop) => (mask & loop) === loop)) continue;
    const s = score(model, mask);
    if (s.tier === "consciousness") loops.push(mask);
    scores.push(s);
  }
  return scores.sort(
      (a, b) =>
        scoreKey(b.loop) - scoreKey(a.loop) ||
        scoreKey(b.awareness) - scoreKey(a.awareness) ||
        a.size - b.size ||
        a.mask - b.mask,
    );
}
