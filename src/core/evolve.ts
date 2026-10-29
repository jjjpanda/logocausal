import { gatesFor, tableFor } from "./gates";
import { observedInfo } from "./info";
import { MAX_INPUTS, SENSES, addNode, members, outputBit, removeNode, validateModel } from "./model";
import type { BinaryNode, NetworkModel, Sense } from "./model";
import type { TierScore } from "./recursion";

export const W = 1600;
export const H = 1000;
export const HISTORY = 96;
export const MIN_NODES = 0;
/** Safety ceiling: exact information analysis grows steeply with population size. */
export const MAX_POPULATION = 14;
export const START_ENERGY = 1.4;
export const SPLIT_ENERGY = 2.2;
/** Limited reserves keep a long feast from removing all future selection pressure. */
export const ENERGY_CAP = 3.3;
/** A neuron that fired this many ticks in a row rests for one tick. */
export const FATIGUE = 3;
export const LIGHT_RANGE = 1200;
/** Pixels the light moves along the edge per tick. */
export const SUN_SPEED = 3;
export const FEED_RANGE = 160;
export const SENSE_RANGE = 380;
export const SMELL_RANGE = SENSE_RANGE;
export const PUSH_FORCE = 1.6;
/** Below COLD, processes slow; above HOT, neurons take heat damage. */
export const COLD = 0.25;
export const HOT = 0.85;
const FIRE_HEAT = 0.06;
const FIRE_COST = 0.008;
const BITE = 0.075;
const HURT = 0.02;
const LOOP_PAY = 0.012;
const UPKEEP = 0.012;
const CAPACITY = 7;
const DARK_DECAY = 0.025;
const FOOD_GROW = 0.32;
const FOOD_SPAWN = 0.3;
export const MAX_FOOD = 8;
export const MAX_FOOD_AMOUNT = 8;
export const FOOD_START_AMOUNT = 4;
const MAX_FEED_RADIUS = FEED_RANGE * 1.4;
/** Leave room for both patches to reach full size without overlapping feeding zones. */
export const FOOD_SPACING = MAX_FEED_RADIUS * 2 + 48;
/** Baseline plasticity rates, scaled by local activity, input usefulness and temperature. */
const GROW = 0.006;
const PRUNE = 0.004;
const ROLE_MUTATE = 0.002;
export const LINK_RANGE = 520;

export type Point = { x: number; y: number };
export interface Bounds { width: number; height: number }
export interface ProcessState { phase: number; streak: number; recent: number[] }
export interface ProcessTiming { rate: number; active: boolean; phase: number }
export interface World {
  bounds?: Bounds;
  minimumNeuronRadius?: number;
  processes?: Record<string, ProcessState>;
  /** Distance of the light along the edge, clockwise from the top-left corner. */
  sun: number;
  food: (Point & { amount: number })[];
}
export type Locate = (id: string) => Point;
export type Cause = "starved" | "overheated";

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

export const worldBounds = (world: World): Bounds => world.bounds ?? { width: W, height: H };

/** Scale the habitat and sun progress; thin food patches if a narrower habitat crowds them. */
export function resizeWorld(world: World, bounds: Bounds): World {
  const previous = worldBounds(world);
  const progress = world.sun / (2 * (previous.width + previous.height));
  return {
    ...world, bounds,
    sun: progress * 2 * (bounds.width + bounds.height),
    food: world.food
      .map(f => ({ ...f, x: f.x * bounds.width / previous.width, y: f.y * bounds.height / previous.height }))
      .reduce<World["food"]>((kept, f) => kept.every(other => dist(other, f) >= FOOD_SPACING) ? [...kept, f] : kept, []),
  };
}

export function sunAt(world: World): Point {
  const { width, height } = worldBounds(world);
  const perimeter = 2 * (width + height);
  const s = ((world.sun % perimeter) + perimeter) % perimeter;
  if (s < width) return { x: s, y: 0 };
  if (s < width + height) return { x: width, y: s - width };
  if (s < 2 * width + height) return { x: 2 * width + height - s, y: height };
  return { x: 0, y: perimeter - s };
}

export const lightAt = (world: World, p: Point) =>
  Math.max(0, 1 - dist(sunAt(world), p) / LIGHT_RANGE);

// Extra stock feeds neurons for longer without inflating or crowding the zones.
export const feedRadius = (f: { amount: number }) => Math.min(MAX_FEED_RADIUS, FEED_RANGE * Math.max(0.65, f.amount));

export const senseRadius = (f: { amount: number }) => Math.max(SENSE_RANGE, feedRadius(f) * 1.8);

export const senseFoodNear = (food: World["food"], p: Point) =>
  food
    .filter((f) => f.amount > 0 && dist(f, p) < senseRadius(f))
    .sort((a, b) => dist(a, p) - dist(b, p))[0];

export const feedFoodNear = (food: World["food"], p: Point) =>
  food
    .filter((f) => f.amount > 0 && dist(f, p) < feedRadius(f))
    .sort((a, b) => dist(a, p) - dist(b, p))[0];

export function spawnFoodNearSun(world: World, rng: () => number = Math.random): (Point & { amount: number }) | undefined {
  const { width, height } = worldBounds(world);
  const sun = sunAt(world);
  const dx = width / 2 - sun.x;
  const dy = height / 2 - sun.y;
  const d = Math.max(1, Math.hypot(dx, dy));
  const ux = dx / d;
  const uy = dy / d;
  const marginX = Math.min(FEED_RANGE + 20, width / 2);
  const marginY = Math.min(FEED_RANGE + 20, height / 2);
  let best: Point | undefined;
  let clearance = -1;
  for (let attempt = 0; attempt < 32; attempt++) {
    // Start inside the warm band so an empty habitat can always grow food. Then
    // search the whole lit habitat instead of piling patches beside the sun.
    const p = attempt === 0 ? {
      x: Math.max(marginX, Math.min(width - marginX, sun.x + ux * LIGHT_RANGE * 0.5)),
      y: Math.max(marginY, Math.min(height - marginY, sun.y + uy * LIGHT_RANGE * 0.5)),
    } : {
      x: marginX + rng() * (width - marginX * 2),
      y: marginY + rng() * (height - marginY * 2),
    };
    if (lightAt(world, p) <= 0) continue;
    const gap = Math.min(Infinity, ...world.food.map(f => dist(p, f)));
    if (gap >= FOOD_SPACING && gap > clearance) {
      best = p;
      clearance = gap;
    }
  }
  return best && { ...best, amount: FOOD_START_AMOUNT };
}

/** Motors act on their own bodies. Springs pass that motion to linked neighbours. */
export function motorVectors(model: NetworkModel, state: number, world: World, locate: Locate): Point[] {
  const sun = sunAt(world);
  return model.nodes.map((node, i) => {
    const stopped = { x: 0, y: 0 };
    if (!node.push || !bit(state, i)) return stopped;
    const p = locate(node.id);
    const target =
      node.push === "light"
        ? lightAt(world, p) > 0 ? sun : undefined
        : senseFoodNear(world.food, p);
    if (!target) return stopped;
    const dx = target.x - p.x;
    const dy = target.y - p.y;
    const d = Math.hypot(dx, dy);
    if (d > 1) {
      // Light movers seek a habitable band instead of driving into the hot sun.
      const drive = node.push === "light" ? Math.max(-1, Math.min(1, (d - LIGHT_RANGE * 0.42) / 90))
        : Math.min(1, d / 80);
      const rate = processRate(temperature(world, p, [state], i, node.id));
      return { x: (dx / d) * PUSH_FORCE * drive * rate, y: (dy / d) * PUSH_FORCE * drive * rate };
    }
    return stopped;
  });
}

/** Heat comes from actual firing events, not signals held while a cold neuron waits. */
export const temperature = (world: World, p: Point, history: number[], i: number, id?: string) => {
  const recent = id ? world.processes?.[id]?.recent : undefined;
  return lightAt(world, p) + FIRE_HEAT * (recent ?? history.slice(-FATIGUE - 1).map(x => bit(x, i))).reduce((sum, x) => sum + x, 0);
};

export const processRate = (heat: number) => Math.max(0.1, Math.min(1, heat / COLD));

export const tired = (history: number[], i: number, world?: World, id?: string) => {
  const process = id ? world?.processes?.[id] : undefined;
  return process ? process.streak >= FATIGUE : history.length >= FATIGUE && history.slice(-FATIGUE).every(x => bit(x, i));
};

/** A fractional local clock retains signals between updates and resumes smoothly on warming. */
export function processTiming(model: NetworkModel, history: number[], world: World, locate: Locate): ProcessTiming[] {
  return model.nodes.map((node, i) => {
    const rate = processRate(temperature(world, locate(node.id), history, i, node.id));
    const phase = (world.processes?.[node.id]?.phase ?? 0) + rate;
    const active = phase >= 1 - 1e-9;
    return { rate, active, phase: Math.max(0, phase - Number(active)) };
  });
}

/** One synchronous tick. Sense-neurons fire true when sensing their goal; logical connections evaluate their gate. */
export function step(model: NetworkModel, history: number[], world: World, locate: Locate, noise: number, rng = Math.random,
  timing = processTiming(model, history, world, locate)) {
  const state = history[history.length - 1];
  return model.nodes.reduce((next, node, i) => {
    if (!timing[i].active) return next | (bit(state, i) << i);
    const p = locate(node.id);
    const sensed =
      node.sense === "light"
        ? lightAt(world, p) >= 0.5
        : node.sense === "food"
          ? !!senseFoodNear(world.food, p)
          : false;
    const logic = node.inputs.length > 0 ? outputBit(node, state) : 0;
    const out = sensed ? 1 : logic;
    return next | ((tired(history, i, world, node.id) ? 0 : out ^ Number(rng() < noise)) << i);
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

/** Each link costs energy, and every neuron pays upkeep every tick so unfed neurons starve. */
export const upkeep = (node: BinaryNode, neighbours: number) =>
  UPKEEP * (1 + 0.35 * node.inputs.length + (node.sense ? 0.15 : 0) + (node.push ? 0.15 : 0)) * Math.max(0.85, (neighbours / CAPACITY) ** 2);

export interface Metabolism {
  rate: number;
  intake: number;
  loop: number;
  upkeep: number;
  firing: number;
  exposure: number;
  heat: number;
  sharing: number;
  overflow: number;
  delta: number;
}

/** Synchronous feeding: scarce stock is divided in proportion to appetite, independent of node order. */
export function metabolism(model: NetworkModel, tiers: TierScore[] | null, history: number[], world: World, locate: Locate,
  timing = processTiming(model, history, world, locate)): Metabolism[] {
  const state = history[history.length - 1];
  const bonus = tiers ? fitness(model, tiers, history) : model.nodes.map(() => 0);
  const meals = model.nodes.map(node => feedFoodNear(world.food, locate(node.id)));
  // Quiet cells can graze slowly; firing still multiplies their appetite fivefold.
  const demands = timing.map((t, i) => BITE * (bit(state, i) ? 1 : 0.2) * t.rate);
  return model.nodes.map((node, i) => {
    const rate = timing[i].rate;
    const meal = meals[i];
    const demand = meals.reduce((sum, m, j) => sum + (m === meal ? demands[j] : 0), 0);
    const intake = meal ? demands[i] * Math.min(1, meal.amount / demand) : 0;
    const heat = temperature(world, locate(node.id), history, i, node.id);
    const neighbours = model.nodes.filter(other => dist(locate(other.id), locate(node.id)) < 240).length;
    const cost = upkeep(node, neighbours) * rate;
    // Useful feedback helps, but cannot pay the whole cost of life without food.
    const loop = Math.min(bonus[i] * LOOP_PAY * rate, cost * 0.6);
    const firing = bit(state, i) * FIRE_COST * rate;
    const exposure = heat > HOT ? HURT : 0;
    return { rate, intake, loop, upkeep: cost, firing, exposure, heat, sharing: 0, overflow: 0, delta: intake + loop - cost - firing - exposure };
  });
}

/** Simultaneous diffusion through links, from richer to poorer, regardless of signal direction.
 * Conductance falls as 1 / length (40 px minimum); donors send at most 10% of their energy per tick.
 * Reciprocal links share one channel. All transfers use the same pre-sharing balances.
 */
export function shareEnergy(model: NetworkModel, balances: number[], locate: Locate, rates = balances.map(() => 1)): number[] {
  const transfers: { from: number; to: number; amount: number }[] = [];
  const outgoing = balances.map(() => 0);
  for (let i = 0; i < model.nodes.length; i++) {
    for (let j = i + 1; j < model.nodes.length; j++) {
      if (!model.nodes[i].inputs.includes(j) && !model.nodes[j].inputs.includes(i)) continue;
      const [from, to] = balances[i] > balances[j] ? [i, j] : [j, i];
      if (balances[from] <= 0) continue;
      const length = Math.max(40, dist(locate(model.nodes[i].id), locate(model.nodes[j].id)));
      const amount = (balances[from] - balances[to]) * 0.02 * 160 / length * Math.min(rates[i], rates[j]);
      outgoing[from] += amount;
      transfers.push({ from, to, amount });
    }
  }
  const net = balances.map(() => 0);
  for (const { from, to, amount } of transfers) {
    const sent = amount * Math.min(1, balances[from] * 0.1 * rates[from] / (outgoing[from] || 1));
    net[from] -= sent;
    net[to] += sent;
  }
  return net;
}

const pickOne = <T>(list: T[], rng: () => number) => list[Math.floor(rng() * list.length)];
const SENSE_KEYS = Object.keys(SENSES) as Sense[];

const OPS = [(a: number, b: number) => a ^ b, (a: number, b: number) => a | b, (a: number, b: number) => a & b];

/** A table with one more input appended, joined to the old output by XOR, OR or AND. */
function widen(table: number[], rng: () => number): number[] {
  if (table.length === 1) return tableFor(pickOne(gatesFor(1), rng), 1);
  const op = pickOne(OPS, rng);
  return Array.from({ length: table.length * 2 }, (_, row) => op(table[row % table.length], Number(row >= table.length)));
}

/** A table with input `k` removed, read as if that input were 0. */
const narrow = (table: number[], k: number) =>
  table.length <= 2
    ? [0]
    : Array.from({ length: table.length / 2 }, (_, row) => table[((row >> k) << (k + 1)) | (row & ((1 << k) - 1))]);

/** A copy of `parent` with at most one change: rewire, add or drop an input, change gate, or evolve sense/push. */
function mutate(
  parent: BinaryNode,
  selfIndex: number,
  neurons: number,
  rng: () => number,
): Pick<BinaryNode, "inputs" | "table" | "sense" | "push"> {
  const { inputs: rawInputs, table: rawTable, sense, push } = parent;
  const validInputs = rawInputs.filter((i) => i !== selfIndex);
  const inputs = validInputs;
  const table = validInputs.length === rawInputs.length ? rawTable : tableFor(gatesFor(inputs.length)[0], inputs.length);
  const free = Array.from({ length: neurons }, (_, i) => i).filter((i) => i !== selfIndex && !inputs.includes(i));
  const gates = gatesFor(inputs.length)
    .map((gate) => tableFor(gate, inputs.length))
    .filter((t) => t.some((v, i) => v !== table[i]));
  const changes = [
    inputs.length && free.length
      ? () => {
          const k = Math.floor(rng() * inputs.length);
          return { inputs: inputs.map((j, i) => (i === k ? pickOne(free, rng) : j)), table, sense, push };
        }
      : null,
    inputs.length < MAX_INPUTS && free.length
      ? () => ({ inputs: [...inputs, pickOne(free, rng)], table: widen(table, rng), sense, push })
      : null,
    inputs.length > 1
      ? () => {
          const k = Math.floor(rng() * inputs.length);
          return { inputs: inputs.filter((_, i) => i !== k), table: narrow(table, k), sense, push };
        }
      : null,
    gates.length ? () => ({ inputs, table: pickOne(gates, rng), sense, push }) : null,
    () => ({ inputs, table, sense: pickOne([...SENSE_KEYS, undefined], rng), push }),
    () => ({ inputs, table, sense, push: pickOne([...SENSE_KEYS, undefined], rng) }),
  ].filter((change) => change !== null);
  return changes.length ? pickOne(changes, rng)() : { inputs, table, sense, push };
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
  const mutated = rng() < 0.25 ? mutate(parent, child, child + 1, rng) : parent;
  const nodes = grown.nodes.map((node, i) => {
    if (i !== child) return node;
    const next: BinaryNode = {
      id: node.id,
      label: familyLabel(model, parent.label),
      inputs: mutated.inputs,
      table: mutated.table,
      ...(mutated.sense ? { sense: mutated.sense } : {}),
      ...(mutated.push ? { push: mutated.push } : {}),
    };
    return next;
  });
  // Let a reader use the child instead of adding another operand to its gate.
  // Budding should preserve working truth tables rather than repeatedly widening them.
  const readers = nodes.flatMap((node, i) => (i !== child && node.inputs.includes(p) ? [i] : []));
  if (readers.length) {
    const j = pickOne(readers, rng);
    nodes[j] = { ...nodes[j], inputs: nodes[j].inputs.map(input => input === p ? child : input) };
  }
  return { ...grown, nodes };
}

/** Slow local plasticity. Stuck neurons explore; variable, influential inputs are retained longer. */
export function adaptNetwork(model: NetworkModel, history: number[], locate: Locate, rng: () => number,
  rates: Map<string, number>): NetworkModel {
  const nodes = model.nodes.map((node, idx) => {
    let next = node;
    const rate = rates.get(node.id) ?? 1;
    const activity = history.reduce((sum, s) => sum + bit(s, idx), 0) / Math.max(1, history.length);
    const stress = history.length * rate < 16 ? 0
      : Math.max(0, (0.15 - activity) / 0.15, (activity - 0.65) / 0.35);
    const free = model.nodes.map((_, i) => i).filter((i) => i !== idx && !next.inputs.includes(i)
      && dist(locate(node.id), locate(model.nodes[i].id)) < LINK_RANGE);
    if (next.inputs.length < MAX_INPUTS && free.length && rng() < GROW * (1 + 2 * stress) * rate) {
      // Nearby partners and closing a reciprocal connection are more likely, not compulsory.
      const weights = free.map(j => (model.nodes[j].inputs.includes(idx) ? 2 : 1)
        / (1 + dist(locate(node.id), locate(model.nodes[j].id)) / 160));
      let draw = rng() * weights.reduce((a, b) => a + b, 0);
      const partner = free.find((_, k) => (draw -= weights[k]) < 0) ?? free.at(-1)!;
      next = { ...next, inputs: [...next.inputs, partner], table: widen(next.table, rng) };
    } else if (next.inputs.length > 1) {
      const usefulness = next.inputs.map((input, k) => {
        const p = history.reduce((sum, s) => sum + bit(s, input), 0) / Math.max(1, history.length);
        const responsiveness = history.reduce((sum, s) => sum
          + Number(outputBit(next, s) !== outputBit(next, s ^ (1 << input))), 0) / Math.max(1, history.length);
        return { k, value: 4 * p * (1 - p) * responsiveness
          / (1 + (dist(locate(node.id), locate(model.nodes[input].id)) / LINK_RANGE) ** 2) };
      });
      const weakest = usefulness.reduce((a, b) => b.value < a.value ? b : a);
      if (rng() < PRUNE * (1 + 4 * (1 - weakest.value)) * rate) {
        const k = weakest.k;
        next = { ...next, inputs: next.inputs.filter((_, i) => i !== k), table: narrow(next.table, k) };
      }
    }
    if (next.inputs.length && rng() < (0.002 + 0.02 * stress) * rate) {
      const alternatives = gatesFor(next.inputs.length).map(g => tableFor(g, next.inputs.length))
        .filter(table => table.some((v, i) => v !== next.table[i]));
      if (alternatives.length) next = { ...next, table: pickOne(alternatives, rng) };
    }
    if (rng() < ROLE_MUTATE * rate) {
      const sense = pickOne([...SENSE_KEYS, undefined], rng);
      if (sense !== next.sense) next = { ...next, sense };
    }
    if (rng() < ROLE_MUTATE * rate) {
      const push = pickOne([...SENSE_KEYS, undefined], rng);
      if (push !== next.push) next = { ...next, push };
    }
    return next;
  });
  return nodes.some((node, i) => node !== model.nodes[i]) ? { ...model, nodes } : model;
}

/**
 * One tick of life. Each neuron pays upkeep, pays to fire, and grazes within feeding range,
 * takes heat damage, and earns a bonus from its live loop. Cold slows biological processes.
 * Neurons at 0 energy die,
 * down to MIN_NODES. The richest neuron above SPLIT_ENERGY clones itself and gives the clone half.
 * Local activity biases plasticity. Food regrows in light; new patches spawn near the sun.
 */
export function live(
  model: NetworkModel,
  tiers: TierScore[] | null,
  history: number[],
  energy: Energy,
  world: World,
  locate: Locate,
  rng: () => number = Math.random,
  timing = processTiming(model, history.slice(0, -1), world, locate),
): { model: NetworkModel; energy: Energy; world: World; events: LifeEvent[]; budgets: Metabolism[] } {
  const n = model.nodes.length;
  const state = history[history.length - 1];
  const processes = Object.fromEntries(model.nodes.map((node, i) => {
    const previous = world.processes?.[node.id];
    const on = bit(state, i);
    const streak = timing[i].active ? (on ? (previous?.streak ?? 0) + 1 : 0) : (previous?.streak ?? 0);
    return [node.id, { phase: timing[i].phase, streak, recent: [...(previous?.recent ?? []), timing[i].active ? on : 0].slice(-FATIGUE - 1) }];
  }));
  const budgets = metabolism(model, tiers, history, { ...world, processes }, locate, timing);
  const food = world.food.map((f) => ({ ...f }));
  const causes: Cause[] = [];
  const fuel = model.nodes.map((node, i) => {
    const p = locate(node.id);
    const { heat, intake, delta } = budgets[i];
    const meal = feedFoodNear(world.food, p);
    if (meal) {
      const patch = food[world.food.indexOf(meal)];
      patch.amount = Math.max(0, patch.amount - intake);
    }
    causes.push(heat > HOT ? "overheated" : "starved");
    return (energy[node.id] ?? START_ENERGY) + delta;
  });
  const shared = shareEnergy(model, fuel, locate, timing.map(t => t.rate));
  shared.forEach((amount, i) => {
    budgets[i].sharing = amount;
    budgets[i].delta += amount;
    fuel[i] += amount;
    const overflow = Math.max(0, fuel[i] - ENERGY_CAP);
    budgets[i].overflow = overflow;
    budgets[i].delta -= overflow;
    fuel[i] -= overflow;
  });
  const dead = fuel
    .flatMap((e, i) => (e <= 0 ? [i] : []))
    .sort((a, b) => fuel[a] - fuel[b])
    .slice(0, Math.max(0, n - MIN_NODES));
  const events: LifeEvent[] = dead.map((i) => ({ kind: "died", label: model.nodes[i].label, cause: causes[i] }));
  const adapted = adaptNetwork(model, history, locate, rng, new Map(model.nodes.map((node, i) => [node.id, timing[i].rate])));
  let next = [...dead].sort((a, b) => b - a).reduce((m, i) => removeNode(m, i), adapted);
  const left: Energy = Object.fromEntries(
    next.nodes.map((node) => [node.id, Math.max(0, fuel[model.nodes.findIndex((o) => o.id === node.id)])]),
  );

  const rich = next.nodes
    .map((node, i) => ({ i, e: left[node.id] }))
    .filter(({ i, e }) => e >= SPLIT_ENERGY && timing[model.nodes.findIndex(n => n.id === next.nodes[i].id)].active)
    .sort((a, b) => b.e - a.e)[0];
  if (rich && next.nodes.length < MAX_POPULATION) {
    const parent = next.nodes[rich.i];
    next = clone(next, rich.i, rng);
    const child = next.nodes[next.nodes.length - 1];
    left[parent.id] = left[child.id] = rich.e / 2;
    events.push({ kind: "born", label: child.label, parent: parent.label });
  }
  validateModel(next);
  const { width, height } = worldBounds(world);
  const nextSun = (world.sun + SUN_SPEED) % (2 * (width + height));
  const retained = Object.fromEntries(next.nodes.map(node => [node.id, processes[node.id] ?? { phase: 0, streak: 0, recent: [] }]));
  const nextWorldBase: World = { ...world, sun: nextSun, processes: retained };
  const grown = food
    .map((f) => {
      const light = lightAt(nextWorldBase, f);
      const amount = light > 0 ? f.amount + FOOD_GROW * light * (1 - f.amount / MAX_FOOD_AMOUNT) : f.amount - DARK_DECAY;
      return { ...f, amount: Math.min(MAX_FOOD_AMOUNT, amount) };
    })
    .filter((f) => f.amount > 0);
  if (grown.length < MAX_FOOD && (rng() < FOOD_SPAWN || grown.length === 0)) {
    const patch = spawnFoodNearSun({ ...nextWorldBase, food: grown }, rng);
    if (patch) grown.push(patch);
  }
  return { model: next, energy: left, world: { ...nextWorldBase, food: grown }, events, budgets };
}
