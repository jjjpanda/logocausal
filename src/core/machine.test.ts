import { describe, expect, it } from "vitest";
import { fixtureModel } from "./fixtures";
import { tableFor } from "./gates";
import type { Gate } from "./gates";
import { connectedCircuits, describeActivity, describeCircuits, describeMachine, largerCircuit } from "./machine";
import { analyze } from "./recursion";
import { validateModel } from "./model";
import type { BinaryNode, NetworkModel } from "./model";

const node = (i: number, inputs: number[], table: number[], extra: Partial<BinaryNode> = {}): BinaryNode =>
  ({ id: String(i), label: String(i), inputs, table, ...extra });
const network = (nodes: BinaryNode[]): NetworkModel => {
  const model: NetworkModel = { version: 1, name: "Machine test", seed: 1, nodes };
  validateModel(model);
  return model;
};

describe("machine descriptions", () => {
  it("describes a group without feedback separately from its neuron rules", () => {
    const machine = describeMachine(fixtureModel("oneway"), 0b11)!;
    expect(machine.name).toBe("Logic circuit");
    expect(machine.connections).toContain("Senses light");
    expect(machine.detail).toContain("No internal feedback");
    expect(machine.rules).toEqual([
      { neuron: "A", name: "Sensor", detail: "Copies its sensed signal." },
      { neuron: "B", name: "COPY", detail: "Copies its input." },
    ]);
  });

  it.each<[Gate, number, string]>([
    ["off", 1, "Stays off."],
    ["on", 1, "Stays on."],
    ["same", 1, "Copies its input."],
    ["not", 1, "Flips on to off and off to on."],
    ["and", 2, "On when all inputs are on."],
    ["nand", 2, "Off only when all inputs are on."],
    ["or", 2, "On when any input is on."],
    ["nor", 2, "On only when all inputs are off."],
    ["xor", 3, "On when an odd number of inputs are on."],
    ["xnor", 3, "On when an even number of inputs are on."],
  ])("explains %s as a neuron rule, without assigning it to the group", (gate, count, detail) => {
    const inputs = Array.from({ length: count }, (_, i) => i + 1);
    const machine = describeMachine(network([
      node(0, inputs, tableFor(gate, count)), ...inputs.map(i => node(i, [], [0])),
    ]), 1)!;
    expect(machine.name).toBe("Logic circuit");
    expect(machine.rules[0].detail).toBe(detail);
    expect(machine.periods).toEqual([]);
  });

  it("does not label constants or a custom majority rule as relays", () => {
    // The simulation keeps an input-free neuron off, even with an always-on table.
    const quiet = describeMachine(network([node(0, [], [1])]), 1)!;
    expect(quiet.name).toBe("Logic circuit");
    expect(quiet.rules[0].detail).toBe("Stays off.");
    const majority = describeMachine(network([
      node(0, [1, 2, 3], [0, 0, 0, 1, 0, 1, 1, 1]),
      ...[1, 2, 3].map(i => node(i, [], [0])),
    ]), 1)!;
    expect(majority.name).toBe("Logic circuit");
    expect(majority.rules[0]).toEqual({ neuron: "0", name: "Custom", detail: "Uses its truth table." });
  });

  it("does not infer a group's function from its component gates", () => {
    const machine = describeMachine(network([
      node(0, [2], [1, 0]), node(1, [0], [1, 0]), node(2, [], [0], { sense: "light" }),
    ]), 0b11)!;
    expect(machine.name).toBe("Logic circuit");
    expect(machine.rules.map(rule => rule.name)).toEqual(["NOT", "NOT"]);
  });

  it("includes the sensory override in hybrid neuron rules", () => {
    const machine = describeMachine(network([
      node(0, [1], [1, 0], { sense: "food" }), node(1, [], [0]),
    ]), 1)!;
    expect(machine.rules[0].detail).toBe("Flips on to off and off to on. Sensing can also turn it on.");
  });

  it("describes warmth-seeking motors without promising movement toward light", () => {
    const machine = describeMachine(network([
      node(0, [], [0], { push: "light" }), node(1, [0], [0, 1], { push: "food" }),
    ]), 0b11)!;
    expect(machine.connections).toContain("seeks comfortable warmth and food");
  });

  it("finds the four-step cycle of an inverting feedback ring", () => {
    const model = fixtureModel("clusters");
    model.nodes[0].table = [1, 0];
    const machine = describeMachine(model, 0b11)!;
    expect(machine.name).toBe("Oscillator");
    expect(machine.periods).toEqual([4]);
  });

  it("distinguishes stable memory from oscillation", () => {
    const model: NetworkModel = { version: 1, name: "OR memory", seed: 1, nodes:
      Array.from({ length: 3 }, (_, i) => ({ id: String(i), label: String(i),
        inputs: [0, 1, 2].filter(j => j !== i), table: [0, 1, 1, 1] })) };
    const machine = describeMachine(model, 0b111)!;
    expect(machine.name).toBe("Stable memory");
    expect(machine.detail).toBe("Can hold one of up to 2 steady patterns.");
    expect(machine.periods).toEqual([]);
    expect(largerCircuit(model, 0b11)).toBe(0b111);
    expect(analyze(model).some(s => s.mask === 0b111)).toBe(false);
  });

  it("reports both capabilities when a copy ring can store or alternate", () => {
    const machine = describeMachine(fixtureModel("clusters"), 0b11)!;
    expect(machine.name).toBe("Memory & oscillator");
    expect(machine.periods).toEqual([2]);
    expect(machine.detail).toBe("Can hold one of up to 2 steady patterns or repeat a cycle every 2 updates.");
  });

  it("checks the influence of held outside signals instead of assuming a group is closed", () => {
    const machine = describeMachine(fixtureModel("overlap"), 0b11)!;
    expect(machine.name).toBe("Memory & oscillator");
    expect(machine.connections).toContain("1 outside neuron input");
    expect(machine.detail).toContain("Can hold");
  });

  it("recognizes feedback that settles to a unique pattern for each input setting", () => {
    const machine = describeMachine(network([
      node(0, [1, 2], [0, 0, 0, 1]), node(1, [0, 2], [0, 1, 1, 1]), node(2, [], [0]),
    ]), 0b11)!;
    expect(machine.name).toBe("Settling feedback");
    expect(machine.periods).toEqual([]);
    expect(machine.detail).toBe("Steady inputs determine one final pattern, whatever the start.");
  });

  it("allows memory and cycles under different steady input settings", () => {
    const machine = describeMachine(network([
      ...Array.from({ length: 3 }, (_, i) => node(i, [(i + 1) % 3, (i + 2) % 3, 3],
        [0, 1, 1, 1, 1, 0, 1, 0])), node(3, [], [0]),
    ]), 0b111)!;
    expect(machine.name).toBe("Memory & oscillator");
    expect(machine.periods).toEqual([2, 6]);
    expect(machine.detail).toBe("Can hold one of up to 2 steady patterns or repeat a cycle every 2 or 6 updates.");
  });

  it("does not count a truth-table-independent edge as feedback", () => {
    const model = fixtureModel("clusters");
    model.nodes[0].table = [0, 0];
    expect(describeMachine(model, 0b11)!.name).toBe("Logic circuit");
  });

  it("keeps analysis bounded for groups with many boundary inputs", () => {
    const model: NetworkModel = { version: 1, name: "Driven", seed: 1, nodes:
      Array.from({ length: 15 }, (_, i) => ({ id: String(i), label: String(i),
        inputs: i < 5 ? [(i + 1) % 5, 5 + i * 2, 6 + i * 2] : [],
        table: i < 5 ? [0, 1, 1, 1, 1, 1, 1, 1] : [0],
        ...(i < 5 ? { sense: "food" as const } : {}) })) };
    const machine = describeMachine(model, 0b11111)!;
    expect(machine.name).toBe("Feedback circuit");
    expect(machine.detail).toBe("Contains feedback; memory and cycles have not been checked.");
    expect(describeMachine(model, 0)).toBeNull();
    expect(describeMachine(model, 0b111111)!.name).toBe("Feedback circuit");
  });

  it("analyzes a copy ring despite ten ignored outside inputs", () => {
    const model = network(Array.from({ length: 15 }, (_, i) => i < 5
      ? node(i, [(i + 1) % 5, 5 + i * 2, 6 + i * 2], [0, 1, 0, 1, 0, 1, 0, 1])
      : node(i, [], [0])));
    const machine = describeMachine(model, 0b11111)!;
    expect(machine.name).toBe("Memory & oscillator");
    expect(machine.periods).toEqual([5]);
    expect(machine.connections).toContain("10 outside neuron inputs");
    expect(machine.rules.every(rule => rule.name === "COPY")).toBe(true);
  });
});

describe("whole circuit context", () => {
  it("follows both readers and inputs without joining separate circuits", () => {
    const model = network([
      node(0, [], [0]), node(1, [0], [0, 1]), node(2, [1], [0, 1]), node(3, [], [0]),
    ]);
    expect(largerCircuit(model, 0b10)).toBe(0b111);
    expect(largerCircuit(model, 0b111)).toBeNull();
    expect(largerCircuit(fixtureModel("clusters"), 0b11)).toBeNull();
  });

  it("finds complete circuits beyond the MI scoring limit without choosing arbitrary slices", () => {
    const chain = (count: number) => network(Array.from({ length: count }, (_, i) =>
      node(i, i ? [i - 1] : [], i ? [0, 1] : [0])));
    expect(largerCircuit(chain(5), 0b11)).toBe(0b11111);
    expect(largerCircuit(chain(6), 0b11)).toBe(0b111111);
    expect(largerCircuit(chain(15), 0b11)).toBeNull();
    expect(largerCircuit(chain(5), 0)).toBeNull();
  });
  it("ignores ineffective links when discovering mechanisms", () => {
    const model = network([node(0, [1], [0, 0]), node(1, [], [0])]);
    expect(connectedCircuits(model)).toEqual([1, 2]);
    expect(largerCircuit(model, 1)).toBeNull();
  });
  it("enumerates a six-neuron ring even though minimal-loop scores stop at five", () => {
    const model = network(Array.from({ length: 6 }, (_, i) => node(i, [(i + 1) % 6], [0, 1])));
    const [circuit] = describeCircuits(model);
    expect(circuit.mask).toBe(63);
    expect(circuit.machine.periods).toEqual([2, 3, 6]);
    expect(circuit.machine.enumeration).toEqual({ states: 64, inputSettings: 1 });
    expect(circuit.machine.name).toBe("Memory & oscillator");
  });
});

describe("observed activity", () => {
  it("requires enough observations before describing a rhythm", () => {
    expect(describeActivity([0, 1, 0, 1])).toContain("Observing");
    expect(describeActivity(Array.from({ length: 24 }, (_, i) => i % 4))).toBe("Repeating rhythm · 4 ticks");
  });
  it("distinguishes silence and fixed signals from repeating rhythms", () => {
    expect(describeActivity(Array(24).fill(0))).toContain("Quiet");
    expect(describeActivity(Array(24).fill(3))).toContain("Holding");
    expect(describeActivity(Array.from({ length: 24 }, (_, i) => i))).toContain("Changing patterns");
  });
});
