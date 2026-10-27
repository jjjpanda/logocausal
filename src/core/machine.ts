import { GATES, gateOf } from "./gates";
import type { Gate } from "./gates";
import { influence } from "./info";
import { members, outputBit } from "./model";
import type { NetworkModel } from "./model";
import { effectiveInputs } from "./topology";

export const MAX_MACHINE_NODES = 14;
/** At most 65,536 transitions per description, evaluated in the analysis worker. */
const MAX_ENUMERATION_BITS = 16;

export interface MachineDescription {
  name: string;
  detail: string;
  connections: string;
  periods: number[];
  rules: { neuron: string; name: string; detail: string }[];
  enumeration?: { states: number; inputSettings: number };
}

export interface CircuitDescription { mask: number; machine: MachineDescription }

const RULE_DETAILS: Record<Gate, string> = {
  off: "Stays off.",
  on: "Stays on.",
  same: "Copies its input.",
  not: "Flips on to off and off to on.",
  and: "On when all inputs are on.",
  nand: "Off only when all inputs are on.",
  or: "On when any input is on.",
  nor: "On only when all inputs are off.",
  xor: "On when an odd number of inputs are on.",
  xnor: "On when an even number of inputs are on.",
};

/** Connected components of effective read-links, including isolated neurons. */
export function connectedCircuits(model: NetworkModel): number[] {
  const neighbours = model.nodes.map(() => new Set<number>());
  effectiveInputs(model).forEach((inputs, i) => inputs.forEach(j => {
    neighbours[i].add(j);
    neighbours[j].add(i);
  }));
  const visited = new Set<number>();
  const circuits: number[] = [];
  for (let i = 0; i < model.nodes.length; i++) {
    if (visited.has(i)) continue;
    const circuit = new Set([i]);
    for (const j of circuit) {
      visited.add(j);
      for (const k of neighbours[j]) circuit.add(k);
    }
    circuits.push([...circuit].reduce((bits, j) => bits | (1 << j), 0));
  }
  return circuits;
}

/** Never join separate circuits or select an arbitrary slice of a larger one. */
export function largerCircuit(model: NetworkModel, mask: number): number | null {
  if (!mask) return null;
  return connectedCircuits(model).find(circuit => circuit !== mask && (circuit & mask) === mask
    && members(circuit, model.nodes.length).length <= MAX_MACHINE_NODES) ?? null;
}

export function describeCircuits(model: NetworkModel): CircuitDescription[] {
  return connectedCircuits(model).flatMap(mask => {
    const machine = describeMachine(model, mask);
    return machine ? [{ mask, machine }] : [];
  });
}

/** Circuit capabilities, independent of a particular live trajectory.
 * Enumerate small groups with each combination of outside bits held constant.
 * Fatigue, temperature and signal noise belong to the live observation, not this test.
 */
export function describeMachine(model: NetworkModel, mask: number): MachineDescription | null {
  const group = members(mask, model.nodes.length);
  if (!group.length || group.length > MAX_MACHINE_NODES) return null;
  const inside = new Set(group);
  const outsideInputs = [...new Set(group.flatMap(i => model.nodes[i].inputs.filter(j => !inside.has(j))))];
  const dependencies = group.map(i => model.nodes[i].inputs.filter((_, k) => influence(model.nodes[i], k) > 0));
  // Ignored read-links do not drive the circuit or consume the enumeration budget.
  const inputs = [...new Set(dependencies.flatMap(reads => reads.filter(j => !inside.has(j))))];
  const sensors = group.filter(i => model.nodes[i].sense);
  const controls = [...inputs, ...sensors.map(i => ~i)];
  const senses = [...new Set(sensors.map(i => model.nodes[i].sense))];
  const motors = [...new Set(group.flatMap(i => model.nodes[i].push ?? []))];
  const connections = [
    senses.length ? `Senses ${senses.join(" and ")}` : "No sensors",
    motors.length ? `seeks ${motors.map(m => m === "light" ? "comfortable warmth" : "food").join(" and ")}` : "no motors",
    outsideInputs.length ? `${outsideInputs.length} outside neuron input${outsideInputs.length === 1 ? "" : "s"}` : "no outside neuron inputs",
  ].join(" · ");
  const rules = group.map((i, k) => {
    const node = model.nodes[i], reads = dependencies[k];
    const table = Array.from({ length: 2 ** reads.length }, (_, row) => {
      const state = reads.reduce((bits, j, slot) => bits | (((row >>> slot) & 1) << j), 0);
      return node.inputs.length ? outputBit(node, state) : 0;
    });
    const gate = gateOf(reads.length, table);
    if (gate === "off" && node.sense) return { neuron: node.label, name: "Sensor", detail: "Copies its sensed signal." };
    const detail = gate ? RULE_DETAILS[gate] : "Uses its truth table.";
    return { neuron: node.label, name: gate ? GATES[gate].name : "Custom",
      detail: node.sense && gate !== "on" ? `${detail} Sensing can also turn it on.` : detail };
  });
  const visiting = new Set<number>(), visited = new Set<number>();
  const cyclic = (i: number): boolean => {
    if (visiting.has(i)) return true;
    if (visited.has(i)) return false;
    visiting.add(i);
    if (dependencies[group.indexOf(i)].filter(j => inside.has(j)).some(cyclic)) return true;
    visiting.delete(i);
    visited.add(i);
    return false;
  };
  const feedback = group.some(cyclic);
  if (!feedback) {
    return { name: "Logic circuit", detail: "No internal feedback. Steady inputs give a steady pattern.", connections, periods: [], rules };
  }
  // Exact state enumeration has its own budget, independent of MI group scoring.
  if (controls.length > 8 || controls.length + group.length > MAX_ENUMERATION_BITS) return { name: "Feedback circuit",
    detail: "Contains feedback; memory and cycles have not been checked.", connections, periods: [], rules };

  const periods = new Set<number>();
  let memory = false, maxFixed = 0;
  for (let context = 0; context < 2 ** controls.length; context++) {
    let outside = 0;
    inputs.forEach((i, k) => { outside |= ((context >>> k) & 1) << i; });
    const next = Array.from({ length: 2 ** group.length }, (_, state) => {
      let global = outside;
      group.forEach((i, k) => { global |= ((state >>> k) & 1) << i; });
      return group.reduce((result, i, k) => {
        const node = model.nodes[i];
        const sensed = node.sense ? (context >>> controls.indexOf(~i)) & 1 : 0;
        const logic = node.inputs.length ? outputBit(node, global) : 0;
        return result | ((sensed | logic) << k);
      }, 0);
    });
    const done = new Set<number>();
    let fixed = 0;
    for (let initial = 0; initial < next.length; initial++) {
      const path = new Map<number, number>();
      let state = initial;
      while (!done.has(state) && !path.has(state)) { path.set(state, path.size); state = next[state]; }
      if (path.has(state)) {
        const period = path.size - path.get(state)!;
        if (period === 1) fixed++;
        else periods.add(period);
      }
      for (const seen of path.keys()) done.add(seen);
    }
    memory ||= fixed > 1;
    maxFixed = Math.max(maxFixed, fixed);
  }
  const rhythms = [...periods].sort((a, b) => a - b);
  const name = memory && rhythms.length ? "Memory & oscillator" : memory ? "Stable memory"
    : rhythms.length ? "Oscillator" : "Settling feedback";
  const cycle = `repeat a cycle every ${rhythms.join(" or ")} updates`;
  const detail = memory ? `Can hold one of up to ${maxFixed} steady patterns${rhythms.length ? ` or ${cycle}` : ""}.`
    : rhythms.length ? `Can ${cycle}.`
    : "Steady inputs determine one final pattern, whatever the start.";
  return { name, detail, connections, periods: rhythms, rules,
    enumeration: { states: 2 ** group.length, inputSettings: 2 ** controls.length } };
}

/** A finite observation of signals, not a claim about a circuit's purpose or future. */
export function describeActivity(patterns: number[]): string {
  const recent = patterns.slice(-48);
  if (recent.length < 12) return `Observing · ${recent.length}/12 ticks`;
  if (recent.every(s => s === 0)) return "Quiet in the recent window";
  if (recent.every(s => s === recent[0])) return "Holding a steady pattern";
  for (let period = 2; period <= Math.min(16, Math.floor(recent.length / 3)); period++) {
    if (recent.slice(period).every((s, k) => s === recent[k])) return `Repeating rhythm · ${period} ticks`;
  }
  return `Changing patterns · ${new Set(recent).size} seen in ${recent.length} ticks`;
}
