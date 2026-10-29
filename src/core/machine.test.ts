import { describe, expect, it } from "vitest";
import { fixtureModel } from "./fixtures";
import { describeActivity, describeMachine } from "./machine";
import type { NetworkModel } from "./model";

describe("machine descriptions", () => {
  it("recognizes a feed-forward sensory relay without claiming memory", () => {
    const machine = describeMachine(fixtureModel("oneway"), 0b11)!;
    expect(machine.name).toBe("Signal relay");
    expect(machine.connections).toContain("Senses light");
    expect(machine.detail).toContain("without an internal feedback cycle");
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
    expect(machine.name).toBe("Memory latch");
    expect(machine.detail).toContain("2 stable patterns");
    expect(machine.periods).toEqual([]);
  });

  it("reports both capabilities when a copy ring can store or alternate", () => {
    const machine = describeMachine(fixtureModel("clusters"), 0b11)!;
    expect(machine.name).toBe("Memory & oscillator");
    expect(machine.periods).toEqual([2]);
  });

  it("checks the influence of held outside signals instead of assuming a group is closed", () => {
    const machine = describeMachine(fixtureModel("overlap"), 0b11)!;
    expect(machine.name).toBe("Memory & oscillator");
    expect(machine.connections).toContain("1 outside neuron input");
    expect(machine.detail).toContain("some outside inputs held steady");
  });

  it("does not count a truth-table-independent edge as feedback", () => {
    const model = fixtureModel("clusters");
    model.nodes[0].table = [0, 0];
    expect(describeMachine(model, 0b11)!.name).toBe("Signal relay");
  });

  it("keeps analysis bounded for groups with many boundary inputs", () => {
    const model: NetworkModel = { version: 1, name: "Driven", seed: 1, nodes:
      Array.from({ length: 15 }, (_, i) => ({ id: String(i), label: String(i),
        inputs: i < 5 ? [(i + 1) % 5, 5 + i * 2, 6 + i * 2] : [],
        table: i < 5 ? [0, 1, 1, 1, 1, 1, 1, 1] : [0],
        ...(i < 5 ? { sense: "food" as const } : {}) })) };
    expect(describeMachine(model, 0b11111)!.name).toBe("Driven feedback circuit");
    expect(describeMachine(model, 0)).toBeNull();
    expect(describeMachine(model, 0b111111)).toBeNull();
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
