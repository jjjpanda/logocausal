import { gatesFor, tableFor } from "./gates";
import { observedInfo } from "./info";
import { MAX_INPUTS, addNode, members, outputBit, removeNode, validateModel } from "./model";
import type { BinaryNode, NetworkModel } from "./model";
import type { TierScore } from "./recursion";

export const W = 660;
export const H = 440;
export const MIN_NODES = 3;
/** Safety ceiling: analysis cost grows steeply with size. Crowding keeps the population well below it. */
export const MAX_POPULATION = 14;
export const START_ENERGY = 1;
export const SPLIT_ENERGY = 2.4;
/** A neuron that fired this many ticks in a row rests for one tick. */
export const FATIGUE = 3;
export const LIGHT_RANGE = 560;
/** Pixels the light moves along the edge per tick. */
const SUN_SPEED = 1.5;
const PERIMETER = 2 * (W + H);
export const SMELL_RANGE = 90;
/** Comfortable temperature band. Outside it a neuron loses energy. */
export const COLD = 0.25;
export const HOT = 0.85;
const FIRE_HEAT = 0.06;
const FIRE_COST = 0.004;
const BITE = 0.05;
const HURT = 0.02;
const LOOP_PAY = 0.04;
const UPKEEP = 0.006;
const CAPACITY = 7;
/** Per-tick chance that a neuron grows a dendrite to a random neuron, or drops one. */
const GROW = 0.01;
const PRUNE = 0.004;

export type Point = { x: number; y: number };
export interface World {
  lit: boolean;
  /** Distance of the light along the edge, clockwise from the top-left corner. */
  sun: number;
  food: (Point & { amount: number })[];
}
export type Locate = (id: string) => Point;
export type Cause = "starved" | "froze" | "overheated";

export interface LifeEvent {
  kind: "born" | "died";
  label: string;
  parent?: string;
  cause?: Cause;
}

/** Energy per neuron ID. */
export type Energy = Record<string, number>;

const bit = (state: number, i: number) => (state >>> i) & 1;
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

export function sunAt(world: World): Point {
  const s = world.sun % PERIMETER;
  if (s < W) return { x: s, y: 0 };
  if (s < W + H) return { x: W, y: s - W };
  if (s < 2 * W + H) return { x: 2 * W + H - s, y: H };
  return { x: 0, y: PERIMETER - s };
}

export const lightAt = (world: World, p: Point) =>
  world.lit ? Math.max(0, 1 - dist(sunAt(world), p) / LIGHT_RANGE) : 0;

const foodNear = (food: World["food"], p: Point) => food.find((f) => f.amount > 0 && dist(f, p) < SMELL_RANGE);

/** Light at the neuron plus heat from its own recent firing. In the dark, firing alone stays below COLD. */
export const temperature = (world: World, p: Point, history: number[], i: number) =>
  lightAt(world, p) + FIRE_HEAT * history.slice(-FATIGUE - 1).reduce((sum, x) => sum + bit(x, i), 0);

export const tired = (history: number[], i: number) =>
  history.length >= FATIGUE && history.slice(-FATIGUE).every((x) => bit(x, i));

/** One synchronous tick. Sensors read the world at their spot, tired neurons rest, noise flips the rest. */
export function step(model: NetworkModel, history: number[], world: World, locate: Locate, noise: number, rng = Math.random) {
  const state = history[history.length - 1];
  return model.nodes.reduce((next, node, i) => {
    const p = locate(node.id);
    const out =
      node.sense === "light"
        ? Number(lightAt(world, p) >= 0.5)
        : node.sense === "food"
          ? Number(!!foodNear(world.food, p))
          : outputBit(node, state);
    return next | ((tired(history, i) ? 0 : out ^ Number(rng() < noise)) << i);
  }, 0);
}

/** A loop's strength in the run so far: its weaker arrow, counted from `history`. */
export function liveLoop(s: TierScore, history: number[], n: number): number {
  const [a, b] = [members(s.model, n), members(s.record, n)];
  return Math.min(observedInfo(history, a, b), observedInfo(history, b, a));
}

/** A neuron's loop bonus: the live strength of the strongest minimal loop it belongs to. */
export function fitness(model: NetworkModel, tiers: TierScore[], history: number[]): number[] {
  const n = model.nodes.length;
  const scores = model.nodes.map(() => 0);
  for (const s of tiers)
    if (s.tier === "consciousness") {
      const live = liveLoop(s, history, n);
      members(s.mask, n).forEach((i) => (scores[i] = Math.max(scores[i], live)));
    }
  return scores;
}

/** Each link costs energy, and every neuron pays more as the network gets crowded. */
export const upkeep = (node: BinaryNode, n: number) => UPKEEP * (1 + node.inputs.length) * (n / CAPACITY) ** 2;

const pickOne = <T>(list: T[], rng: () => number) => list[Math.floor(rng() * list.length)];

const OPS = [(a: number, b: number) => a ^ b, (a: number, b: number) => a | b, (a: number, b: number) => a & b];

/** A table with one more input appended, joined to the old output by XOR, OR or AND. */
function widen(table: number[], rng: () => number): number[] {
  const op = pickOne(OPS, rng);
  return Array.from({ length: table.length * 2 }, (_, row) => op(table[row % table.length], Number(row >= table.length)));
}

/** A table with input `k` removed, read as if that input were 0. */
const narrow = (table: number[], k: number) =>
  Array.from({ length: table.length / 2 }, (_, row) => table[((row >> k) << (k + 1)) | (row & ((1 << k) - 1))]);

/** A copy of `parent` with at most one change: rewire, add or drop an input, or change the gate. */
function mutate(parent: BinaryNode, neurons: number, rng: () => number): Pick<BinaryNode, "inputs" | "table"> {
  const { inputs, table } = parent;
  const free = Array.from({ length: neurons }, (_, i) => i).filter((i) => !inputs.includes(i));
  const gates = gatesFor(inputs.length)
    .map((gate) => tableFor(gate, inputs.length))
    .filter((t) => t.some((v, i) => v !== table[i]));
  const changes = [
    inputs.length && free.length
      ? () => {
          const k = Math.floor(rng() * inputs.length);
          return { inputs: inputs.map((j, i) => (i === k ? pickOne(free, rng) : j)), table };
        }
      : null,
    inputs.length < MAX_INPUTS && free.length ? () => ({ inputs: [...inputs, pickOne(free, rng)], table: widen(table, rng) }) : null,
    inputs.length > 1
      ? () => {
          const k = Math.floor(rng() * inputs.length);
          return { inputs: inputs.filter((_, i) => i !== k), table: narrow(table, k) };
        }
      : null,
    gates.length ? () => ({ inputs, table: pickOne(gates, rng) }) : null,
  ].filter((change) => change !== null);
  return changes.length ? pickOne(changes, rng)() : { inputs, table };
}

/** The family name a neuron shares with all its clones: B, B2 and B3 are family B. */
export const familyOf = (label: string) => label.replace(/\d+$/, "") || label;

function familyLabel(model: NetworkModel, parent: string): string {
  const family = familyOf(parent);
  let k = 2;
  while (model.nodes.some((node) => node.label === `${family}${k}`)) k++;
  return `${family}${k}`;
}

function clone(model: NetworkModel, p: number, rng: () => number): NetworkModel {
  const parent = model.nodes[p];
  const child = model.nodes.length;
  const grown = addNode(model);
  const nodes = grown.nodes.map((node, i) =>
    i === child ? { ...node, label: familyLabel(model, parent.label), ...mutate(parent, child + 1, rng) } : node,
  );
  const readers = nodes.flatMap((node, i) => (i !== child && !node.sense && node.inputs.length < MAX_INPUTS ? [i] : []));
  if (readers.length) {
    const j = readers.includes(p) && rng() < 0.5 ? p : pickOne(readers, rng);
    nodes[j] = { ...nodes[j], inputs: [...nodes[j].inputs, child], table: widen(nodes[j].table, rng) };
  }
  return { ...grown, nodes };
}

/** Random dendrite growth and pruning. Sensors read the world, so they grow none. */
function rewire(model: NetworkModel, rng: () => number): NetworkModel {
  const nodes = model.nodes.map((node) => {
    if (node.sense) return node;
    const free = model.nodes.map((_, i) => i).filter((i) => !node.inputs.includes(i));
    if (node.inputs.length < MAX_INPUTS && free.length && rng() < GROW)
      return { ...node, inputs: [...node.inputs, pickOne(free, rng)], table: widen(node.table, rng) };
    if (node.inputs.length > 1 && rng() < PRUNE) {
      const k = Math.floor(rng() * node.inputs.length);
      return { ...node, inputs: node.inputs.filter((_, i) => i !== k), table: narrow(node.table, k) };
    }
    return node;
  });
  return nodes.some((node, i) => node !== model.nodes[i]) ? { ...model, nodes } : model;
}

/**
 * One tick of life. Each neuron pays upkeep, pays to fire, eats when it fires within smell of food,
 * hurts outside the COLD–HOT band, and earns a bonus from its live loop. Neurons at 0 energy die,
 * down to MIN_NODES. The richest logic neuron (not a sensor) above SPLIT_ENERGY clones itself and gives the clone half.
 * Neurons grow and prune dendrites at random. Eaten food grows back near the middle. The light moves along the edge.
 */
export function live(
  model: NetworkModel,
  tiers: TierScore[] | null,
  history: number[],
  energy: Energy,
  world: World,
  locate: Locate,
  rng: () => number = Math.random,
): { model: NetworkModel; energy: Energy; world: World; events: LifeEvent[] } {
  const n = model.nodes.length;
  const state = history[history.length - 1];
  const bonus = tiers ? fitness(model, tiers, history) : model.nodes.map(() => 0);
  const food = world.food.map((f) => ({ ...f }));
  const causes: Cause[] = [];
  const fuel = model.nodes.map((node, i) => {
    const p = locate(node.id);
    const on = bit(state, i);
    const heat = temperature(world, p, history, i);
    const meal = on ? foodNear(food, p) : undefined;
    if (meal) meal.amount -= BITE;
    causes.push(heat < COLD ? "froze" : heat > HOT ? "overheated" : "starved");
    return (
      (energy[node.id] ?? START_ENERGY) +
      (meal ? BITE : 0) +
      bonus[i] * LOOP_PAY -
      upkeep(node, n) -
      on * FIRE_COST -
      (heat < COLD || heat > HOT ? HURT : 0)
    );
  });
  const dead = fuel
    .flatMap((e, i) => (e <= 0 ? [i] : []))
    .sort((a, b) => fuel[a] - fuel[b])
    .slice(0, Math.max(0, n - MIN_NODES));
  const events: LifeEvent[] = dead.map((i) => ({ kind: "died", label: model.nodes[i].label, cause: causes[i] }));
  let next = [...dead].sort((a, b) => b - a).reduce((m, i) => removeNode(m, i), model);
  const left: Energy = Object.fromEntries(
    next.nodes.map((node) => [node.id, Math.max(0, fuel[model.nodes.findIndex((o) => o.id === node.id)])]),
  );

  const rich = next.nodes
    .map((node, i) => ({ i, e: left[node.id], sensor: !!node.sense }))
    .filter(({ e, sensor }) => e >= SPLIT_ENERGY && !sensor)
    .sort((a, b) => b.e - a.e)[0];
  if (rich && next.nodes.length < MAX_POPULATION) {
    const parent = next.nodes[rich.i];
    next = clone(next, rich.i, rng);
    const child = next.nodes[next.nodes.length - 1];
    left[parent.id] = left[child.id] = rich.e / 2;
    events.push({ kind: "born", label: child.label, parent: parent.label });
  }
  next = rewire(next, rng);
  validateModel(next);
  const grown = food.map((f) =>
    f.amount > 0 ? f : { x: W / 2 + (rng() - 0.5) * 300, y: H / 2 + (rng() - 0.5) * 200, amount: 1 },
  );
  return { model: next, energy: left, world: { ...world, sun: (world.sun + SUN_SPEED) % PERIMETER, food: grown }, events };
}
