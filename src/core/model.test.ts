import { describe, expect, it } from "vitest";
import { GATES, gateOf, gatesFor, tableFor } from "./gates";
import { fixtureModel } from "./fixtures";
import { MAX_NODES, addNode, outputBit, randomModel, removeNode, validateModel } from "./model";

describe("gates", () => {
  it("builds the Boolean truth tables", () => {
    expect(tableFor("or", 2)).toEqual([0, 1, 1, 1]);
    expect(tableFor("and", 2)).toEqual([0, 0, 0, 1]);
    expect(tableFor("xor", 3)).toEqual([0, 1, 1, 0, 1, 0, 0, 1]);
    expect(tableFor("nand", 2)).toEqual([1, 1, 1, 0]);
    expect(tableFor("not", 1)).toEqual([1, 0]);
  });

  it("recognises every gate and prints its formula", () => {
    for (const n of [0, 1, 2, 3])
      for (const gate of gatesFor(n)) expect(gateOf(n, tableFor(gate, n))).toBe(gate);
    expect(GATES.nor.show(["A", "C"])).toBe("¬(A ∨ C)");
    expect(GATES.xor.show(["A", "B", "C"])).toBe("A ⊕ B ⊕ C");
  });
});

describe("model", () => {
  it("generates valid, reproducible random networks up to the maximum", () => {
    for (const n of [2, 8, MAX_NODES]) validateModel(randomModel(n, 5));
    expect(randomModel(12, 9)).toEqual(randomModel(12, 9));
    expect(randomModel(12, 9)).not.toEqual(randomModel(12, 10));
  });

  it("rejects networks outside the size and input limits", () => {
    const model = randomModel(MAX_NODES, 1);
    expect(() => validateModel({ ...model, nodes: [...model.nodes, ...model.nodes] })).toThrow();
    const wide = fixtureModel("overlap");
    wide.nodes[0] = { ...wide.nodes[0], inputs: [0, 1, 2, 3], table: Array(16).fill(0) };
    expect(() => validateModel(wide)).toThrow();
    let full = randomModel(MAX_NODES, 1);
    expect(() => addNode(full)).toThrow();
    const selfConn = fixtureModel("forager");
    selfConn.nodes[0] = { ...selfConn.nodes[0], inputs: [0], table: [0, 1] };
    expect(() => validateModel(selfConn)).toThrow();
    const dualRole = fixtureModel("forager");
    dualRole.nodes[0] = { ...dualRole.nodes[0], sense: "food", push: "light", inputs: [1], table: [1, 0] };
    expect(() => validateModel(dualRole)).not.toThrow();
    full = removeNode(full, 0);
    expect(full.nodes).toHaveLength(MAX_NODES - 1);
  });

  it("fixes a removed neuron to zero in the rules that read it", () => {
    const model = removeNode(fixtureModel("overlap"), 0);
    expect(model.nodes[0].inputs).toEqual([1]);
    expect(outputBit(model.nodes[0], 0b10)).toBe(1);
    expect(outputBit(model.nodes[0], 0b00)).toBe(0);
  });
});
