import { describe, expect, it } from "vitest";
import { groupHistory } from "./history";
import type { Frame, NeuronSample } from "./history";
import { fixtureModel } from "./fixtures";
import { removeNode } from "./model";

const model = fixtureModel("clusters");
const frame = (tick: number, signal = true): Frame => ({ tick, neurons: Object.fromEntries(model.nodes.map(node => [node.id, {
  node, readIds: node.inputs.map(i => model.nodes[i].id), signal, on: false, energy: 1, heat: 0.2,
} satisfies NeuronSample])) });

describe("recorded group signals", () => {
  it("retains the chart across rule changes but restarts current-rule inference", () => {
    const frames = [frame(1), frame(2), frame(3)];
    const changed = { ...model, nodes: model.nodes.map((node, i) => i ? node : { ...node, table: [1, 0] }) };
    const history = groupHistory(changed, 3, frames);
    expect(history.timeline).toHaveLength(3);
    expect(history.timeline.map(sample => sample.signals)).toEqual([[true, true], [true, true], [true, true]]);
    expect(history.patterns).toEqual([]);
    const next = frame(4);
    next.neurons[model.nodes[0].id].node = changed.nodes[0];
    const recorded = groupHistory(changed, 3, [...frames, next]);
    expect(recorded.timeline.at(-1)!.changed).toBe(true);
    expect(recorded.patterns).toEqual([3]);
  });

  it("follows IDs through index changes and records held signals separately from firing", () => {
    const moved = removeNode(model, 0);
    const history = groupHistory(moved, 2, [frame(1)]);
    expect(history.timeline[0].signals).toEqual([true]);
    expect(history.patterns).toEqual([1]);
  });

  it("shows gaps before birth and keeps earlier samples for existing members", () => {
    const before = frame(1), after = frame(2);
    delete before.neurons[model.nodes[1].id];
    const history = groupHistory(model, 3, [before, after]);
    expect(history.timeline[0].signals).toEqual([true, undefined]);
    expect(history.timeline[0].pattern).toBeNull();
    expect(history.timeline[1].changed).toBe(true);
    expect(history.patterns).toEqual([3]);
  });

  it("does not reset observations after unrelated rewiring or a motor change", () => {
    const changed = { ...model, nodes: model.nodes.map((node, i) => i === 3 ? { ...node, table: [1, 0] } : { ...node, push: "food" as const }) };
    expect(groupHistory(changed, 3, [frame(1), frame(2)]).patterns).toEqual([3, 3]);
  });
});
