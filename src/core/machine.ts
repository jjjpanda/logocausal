import { gateOf } from "./gates";
import { influence } from "./info";
import { members, outputBit } from "./model";
import type { NetworkModel } from "./model";
import { MAX_GROUP } from "./recursion";

export interface MachineDescription {
  name: string;
  detail: string;
  connections: string;
  periods: number[];
}

/** Circuit capabilities, independent of a particular live trajectory.
 * Enumerate small groups with each combination of outside bits held constant.
 * Fatigue, temperature and signal noise belong to the live observation, not this test.
 */
export function describeMachine(model: NetworkModel, mask: number): MachineDescription | null {
  const group = members(mask, model.nodes.length);
  if (!group.length || group.length > MAX_GROUP) return null;
  const inside = new Set(group);
  const inputs = [...new Set(group.flatMap(i => model.nodes[i].inputs.filter(j => !inside.has(j))))];
  const sensors = group.filter(i => model.nodes[i].sense);
  const controls = [...inputs, ...sensors.map(i => ~i)];
  const senses = [...new Set(sensors.map(i => model.nodes[i].sense))];
  const motors = [...new Set(group.flatMap(i => model.nodes[i].push ?? []))];
  const connections = [
    senses.length ? `Senses ${senses.join(" and ")}` : "No sensors",
    motors.length ? `moves toward ${motors.join(" and ")}` : "no motors",
    inputs.length ? `${inputs.length} outside neuron input${inputs.length === 1 ? "" : "s"}` : "no outside neuron inputs",
  ].join(" · ");
  const dependencies = group.map(i => model.nodes[i].inputs.filter((j, k) => inside.has(j) && influence(model.nodes[i], k) > 0));
  const visiting = new Set<number>(), visited = new Set<number>();
  const cyclic = (i: number): boolean => {
    if (visiting.has(i)) return true;
    if (visited.has(i)) return false;
    visiting.add(i);
    if (dependencies[group.indexOf(i)].some(cyclic)) return true;
    visiting.delete(i);
    visited.add(i);
    return false;
  };
  const feedback = group.some(cyclic);
  if (!feedback) {
    const gates = group.map(i => gateOf(model.nodes[i].inputs.length, model.nodes[i].table));
    const name = gates.some(g => g === "xor" || g === "xnor") ? "Parity circuit"
      : gates.some(g => g === "and" || g === "nand") ? "Coincidence circuit"
      : gates.some(g => g === "or" || g === "nor") ? "Signal combiner"
      : gates.includes("not") ? "Signal inverter" : "Signal relay";
    return { name, detail: "Signals pass through without an internal feedback cycle; steady inputs eventually give a steady output.", connections, periods: [] };
  }
  // Keep this bounded on the UI thread. Large boundaries get a structural description.
  if (controls.length > 8) return { name: "Driven feedback circuit",
    detail: "Signals feed back within the group. Its memory and timing depend on the outside signals driving it.", connections, periods: [] };

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
  const name = memory && rhythms.length ? "Memory & oscillator" : memory ? "Memory latch"
    : rhythms.length ? "Oscillator" : "Settling feedback";
  const conditions = controls.length ? "With some outside inputs held steady" : "With no outside inputs";
  const details = [
    memory ? `it can retain one of up to ${maxFixed} stable patterns` : "",
    rhythms.length ? `it can cycle every ${rhythms.join(", ")} gate steps` : "",
  ].filter(Boolean);
  const detail = details.length ? `${conditions}, ${details.join("; ")}.`
    : "Every starting pattern settles to a single steady pattern for each setting of the outside inputs.";
  return { name, detail, connections, periods: rhythms };
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
