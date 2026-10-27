import type { BinaryNode, NetworkModel } from "./model";

/** MI in bits of a joint count table with `width` columns. `correct` removes the Miller–Madow sampling bias. */
function mutualInformation(joint: Float64Array, width: number, correct = false): number {
  const total = joint.reduce((sum, v) => sum + v, 0);
  const rows = new Float64Array(joint.length / width);
  const cols = new Float64Array(width);
  joint.forEach((v, k) => {
    rows[Math.floor(k / width)] += v;
    cols[k % width] += v;
  });
  if (!total) return 0;
  let bits = 0;
  joint.forEach((v, k) => {
    if (v > 0) bits += (v / total) * Math.log2((v * total) / (rows[Math.floor(k / width)] * cols[k % width]));
  });
  const used = (list: Float64Array) => list.filter((v) => v > 0).length;
  if (correct) bits -= (used(joint) - used(rows) - used(cols) + 1) / (2 * total * Math.LN2);
  return Math.max(0, bits);
}

const pick = (state: number, neurons: number[]) => neurons.reduce((x, i, k) => x | (((state >>> i) & 1) << k), 0);

/** I(from_t ; to_{t+1}) counted over the consecutive states of a run. Frozen neurons score 0. */
export function observedInfo(history: number[], from: number[], to: number[]): number {
  const joint = new Float64Array(2 ** (from.length + to.length));
  for (let t = 1; t < history.length; t++) joint[(pick(history[t - 1], from) << to.length) | pick(history[t], to)]++;
  return mutualInformation(joint, 2 ** to.length, true);
}

/**
 * Exact I(from_t ; to_{t+1}) when all present neurons are random and independent.
 * Only neurons in `from` or read by `to` matter, so only those are enumerated. A sensor copies
 * its own random outside bit, keyed ~j.
 */
export function groupInfo(model: NetworkModel, from: number[], to: number[]): number {
  const sources = (j: number) => [...model.nodes[j].inputs, ...(model.nodes[j].sense ? [~j] : [])];
  const used = [...new Set([...from, ...to.flatMap(sources)])];
  const slot = new Map(used.map((node, i) => [node, i]));
  const fromSlots = from.map((i) => slot.get(i)!);
  const rules = to.map((j) => {
    const node = model.nodes[j];
    const base = node.inputs.length ? node.table : [0];
    return {
      slots: sources(j).map((i) => slot.get(i)!),
      table: node.sense ? [...base, ...base.map(() => 1)] : base,
    };
  });
  const joint = new Float64Array(2 ** (from.length + to.length));
  for (let u = 0; u < 2 ** used.length; u++) {
    let x = 0;
    fromSlots.forEach((s, i) => (x |= ((u >>> s) & 1) << i));
    let y = 0;
    rules.forEach(({ slots, table }, i) => {
      let row = 0;
      slots.forEach((s, k) => (row |= ((u >>> s) & 1) << k));
      y |= table[row] << i;
    });
    joint[(x << to.length) | y]++;
  }
  return mutualInformation(joint, 2 ** to.length);
}

/** Share of settings of the other inputs in which flipping input `k` flips the output. */
export function influence(node: BinaryNode, k: number): number {
  let flips = 0;
  for (let row = 0; row < node.table.length; row++)
    if (!((row >>> k) & 1) && node.table[row] !== node.table[row | (1 << k)]) flips++;
  return flips / (node.table.length / 2);
}

/** matrix[i][j]: how much neuron j depends on neuron i. */
export function influences(model: NetworkModel): number[][] {
  const matrix = model.nodes.map(() => model.nodes.map(() => 0));
  model.nodes.forEach((node, j) =>
    node.inputs.forEach((i, k) => (matrix[i][j] = influence(node, k))),
  );
  return matrix;
}
