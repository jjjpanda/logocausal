import { influence } from "./info";
import { members } from "./model";
import type { NetworkModel } from "./model";

/** Read-links that can change their neuron's truth-table output. */
export const effectiveInputs = (model: NetworkModel): number[][] => model.nodes
  .map(node => node.inputs.filter((_, k) => influence(node, k) > 0));

/** Maximal feedback components; every member can influence every other member. */
export function feedbackComponents(model: NetworkModel): number[] {
  const n = model.nodes.length;
  const reach = effectiveInputs(model).map((inputs, i) => inputs.reduce((mask, j) => mask | (1 << j), 1 << i));
  for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) {
    if (reach[i] & (1 << k)) reach[i] |= reach[k];
  }
  const components: number[] = [];
  let visited = 0;
  for (let i = 0; i < n; i++) {
    if (visited & (1 << i)) continue;
    let component = 0;
    for (const j of members(reach[i], n)) if (reach[j] & (1 << i)) component |= 1 << j;
    visited |= component;
    if (component & (component - 1)) components.push(component);
  }
  return components;
}

/** Directed signal distances, bounded to the local paths plasticity can reinforce. */
export function downstreamDistances(reads: number[][], source: number, maxDepth = 4): number[] {
  const distances = reads.map(() => Infinity);
  distances[source] = 0;
  const queue = [source];
  for (const current of queue) {
    if (distances[current] >= maxDepth) continue;
    reads.forEach((inputs, reader) => {
      if (inputs.includes(current) && distances[reader] === Infinity) {
        distances[reader] = distances[current] + 1;
        queue.push(reader);
      }
    });
  }
  return distances;
}
