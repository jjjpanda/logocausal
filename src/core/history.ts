import type { Metabolism, LifeEvent } from "./evolve";
import type { BinaryNode, NetworkModel } from "./model";
import { members } from "./model";

export interface NeuronSample {
  node: BinaryNode;
  readIds: string[];
  /** The held Boolean signal, including ticks without a local update. */
  signal: boolean;
  /** Whether the neuron actually fired on this tick. */
  on: boolean;
  energy: number;
  heat: number;
  budget?: Metabolism;
}

export interface Frame { tick: number; neurons: Record<string, NeuronSample> }
export type RecordedEvent = LifeEvent & { tick: number; id: string; parentId?: string };

export function sameRule(a: Pick<NeuronSample, "node" | "readIds">, b: Pick<NeuronSample, "node" | "readIds">): boolean {
  return a.node.sense === b.node.sense && a.node.table.join() === b.node.table.join()
    && a.readIds.length === b.readIds.length && a.readIds.every((id, i) => id === b.readIds[i]);
}

/** Project recorded signals by persistent ID; never invent history for a newborn. */
export function groupHistory(model: NetworkModel, mask: number, frames: Frame[]) {
  const group = members(mask, model.nodes.length).map(i => {
    const node = model.nodes[i];
    return { node, readIds: node.inputs.map(j => model.nodes[j].id) };
  });
  const timeline = frames.map((frame, t) => {
    const samples = group.map(({ node }) => frame.neurons[node.id]);
    const previous = frames[t - 1];
    return {
      tick: frame.tick,
      signals: samples.map(sample => sample?.signal),
      pattern: samples.every(Boolean) ? samples.reduce((bits, sample, i) => bits | (Number(sample.signal) << i), 0) : null,
      changed: !!previous && group.some(({ node }) => {
        const before = previous.neurons[node.id], after = frame.neurons[node.id];
        return !!before !== !!after || (before && after && !sameRule(before, after));
      }),
      compatible: samples.every((sample, i) => sample && sameRule(sample, group[i])),
    };
  });
  // Rhythm inference needs one unchanged circuit; its chart retains every observation.
  let boundary = timeline.length - 1;
  while (boundary >= 0 && timeline[boundary].compatible) boundary--;
  const patterns = timeline.slice(boundary + 1).map(sample => sample.pattern!);
  return { timeline, patterns };
}
