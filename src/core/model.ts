import { gatesFor, tableFor } from "./gates";

export const SENSES = { light: "☀", food: "◆" } as const;
export type Sense = keyof typeof SENSES;

/** Node 0 is the least significant bit of a state. Table row bit k is input k. A sensor reads the world, not neurons. */
export interface BinaryNode {
  id: string;
  label: string;
  inputs: number[];
  table: number[];
  sense?: Sense;
}

export interface NetworkModel {
  version: 1;
  name: string;
  seed: number;
  nodes: BinaryNode[];
}

export const MAX_NODES = 24;
export const MAX_INPUTS = 3;

export const letter = (i: number) => String.fromCharCode(65 + i);

export const makeNode = (
  id: string,
  label: string,
  inputs: number[],
  table: number[],
): BinaryNode => ({ id, label, inputs, table });

export const makeSensor = (id: string, label: string, sense: Sense): BinaryNode => ({ id, label, inputs: [], table: [0], sense });

export function validateModel(value: unknown): asserts value is NetworkModel {
  const model = value as NetworkModel;
  if (!model || typeof model !== "object" || model.version !== 1)
    throw new Error("Only model schema version 1 is supported.");
  if (typeof model.name !== "string" || !model.name.trim() || model.name.length > 100)
    throw new Error("The model name must contain 1–100 characters.");
  if (!Number.isSafeInteger(model.seed) || model.seed < 0 || model.seed > 0xffffffff)
    throw new Error("Seed must be an unsigned 32-bit integer.");
  if (!Array.isArray(model.nodes) || model.nodes.length < 2 || model.nodes.length > MAX_NODES)
    throw new Error(`A network needs 2–${MAX_NODES} neurons.`);
  const ids = new Set<string>();
  const labels = new Set<string>();
  for (const [i, node] of model.nodes.entries()) {
    if (!node || typeof node !== "object") throw new Error(`Neuron ${i} must be an object.`);
    if (typeof node.id !== "string" || !node.id.trim() || node.id.length > 100 || ids.has(node.id))
      throw new Error("Neuron IDs must be nonempty, unique strings of at most 100 characters.");
    ids.add(node.id);
    if (
      typeof node.label !== "string" ||
      !node.label.trim() ||
      node.label.length > 24 ||
      labels.has(node.label.trim())
    )
      throw new Error(`Neuron ${i} needs a unique label of 1–24 characters.`);
    labels.add(node.label.trim());
    if (
      !Array.isArray(node.inputs) ||
      node.inputs.length > MAX_INPUTS ||
      new Set(node.inputs).size !== node.inputs.length ||
      node.inputs.some((j) => !Number.isInteger(j) || j < 0 || j >= model.nodes.length)
    )
      throw new Error(`Neuron ${i} reads at most ${MAX_INPUTS} distinct neurons.`);
    if (
      !Array.isArray(node.table) ||
      node.table.length !== 2 ** node.inputs.length ||
      node.table.some((bit) => bit !== 0 && bit !== 1)
    )
      throw new Error(`Neuron ${i}'s truth table must contain exactly ${2 ** node.inputs.length} binary outputs.`);
    if (node.sense !== undefined && (!(node.sense in SENSES) || node.inputs.length))
      throw new Error(`Sensor ${i} reads no neurons.`);
  }
}

export function members(mask: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => i).filter((i) => (mask & (1 << i)) !== 0);
}

export function popcount(mask: number): number {
  let count = 0;
  for (; mask; mask &= mask - 1) count++;
  return count;
}

export const outputBit = (node: BinaryNode, state: number): number =>
  node.table[node.inputs.reduce((row, input, k) => row | (((state >>> input) & 1) << k), 0)];

/** Mulberry32: reproducible layouts and random networks. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomModel(count: number, seed: number): NetworkModel {
  const rng = seededRandom(seed);
  const pick = <T>(list: T[]) => list[Math.floor(rng() * list.length)];
  const nodes = Array.from({ length: count }, (_, i) => {
    const inputs: number[] = [];
    const degree = Math.min(count, pick([1, 2, 2, 2, 3]));
    while (inputs.length < degree) {
      const j = Math.floor(rng() * count);
      if (!inputs.includes(j)) inputs.push(j);
    }
    inputs.sort((a, b) => a - b);
    if (rng() < 0.25) return makeSensor(`node-${i}`, letter(i), pick(Object.keys(SENSES) as Sense[]));
    return makeNode(`node-${i}`, letter(i), inputs, tableFor(pick(gatesFor(degree)), degree));
  });
  return { version: 1, name: `Random ${count}`, seed, nodes };
}

export function addNode(model: NetworkModel): NetworkModel {
  validateModel(model);
  if (model.nodes.length >= MAX_NODES) throw new Error(`A network holds at most ${MAX_NODES} neurons.`);
  const i = model.nodes.length;
  let id = `node-${i}`;
  while (model.nodes.some((node) => node.id === id)) id += "-new";
  let label = letter(i);
  for (let suffix = 2; model.nodes.some((node) => node.label.trim() === label); suffix++)
    label = `${letter(i)}${suffix}`;
  return { ...model, nodes: [...model.nodes, makeNode(id, label, [i], [0, 1])] };
}

/** Removing a neuron fixes its present bit to zero in every rule that read it. */
export function removeNode(model: NetworkModel, removed: number): NetworkModel {
  validateModel(model);
  if (model.nodes.length <= 2) throw new Error("Keep at least 2 neurons.");
  if (!Number.isInteger(removed) || removed < 0 || removed >= model.nodes.length)
    throw new Error("Invalid neuron index.");
  return {
    ...model,
    nodes: model.nodes
      .filter((_, i) => i !== removed)
      .map((node) => {
        const retained = node.inputs.filter((i) => i !== removed);
        const table = Array.from({ length: 2 ** retained.length }, (_, row) => {
          const oldRow = node.inputs.reduce((bits, input, j) => {
            const k = retained.indexOf(input);
            return bits | (k < 0 ? 0 : ((row >>> k) & 1) << j);
          }, 0);
          return node.table[oldRow];
        });
        return {
          ...node,
          inputs: retained.map((i) => (i > removed ? i - 1 : i)),
          table,
        };
      }),
  };
}

/** Carry each bit of `state` from `from` to `to` by neuron ID. New neurons start off. */
export function remapState(state: number, from: NetworkModel, to: NetworkModel): number {
  const index = new Map(from.nodes.map((node, i) => [node.id, i]));
  return to.nodes.reduce((next, node, i) => {
    const j = index.get(node.id);
    return j === undefined ? next : next | (((state >>> j) & 1) << i);
  }, 0);
}
