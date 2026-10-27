import { expect, it } from "vitest";
import { feedbackComponents, effectiveInputs, downstreamDistances } from "./topology";
import type { NetworkModel } from "./model";

const network = (reads: number[][]): NetworkModel => ({ version: 1, name: "Paths", seed: 1,
  nodes: reads.map((inputs, i) => ({ id: String(i), label: String(i), inputs,
    table: inputs.length ? [0, 1] : [0] })) });

it("separates a feedback core from its feedforward appendages", () => {
  expect(feedbackComponents(network([[1], [0], [1], [2], []]))).toEqual([3]);
  expect(feedbackComponents(network([[1], [2], [0], [4], [3]]))).toEqual([7, 24]);
});

it("does not treat an ineffective truth-table edge as feedback", () => {
  const model = network([[1], [0]]);
  model.nodes[0].table = [0, 0];
  expect(feedbackComponents(model)).toEqual([]);
});

it("follows signal direction and bounds the path search", () => {
  const reads = effectiveInputs(network([[], [0], [1], [2], [3], [4]]));
  expect(downstreamDistances(reads, 0)).toEqual([0, 1, 2, 3, 4, Infinity]);
  expect(downstreamDistances(reads, 3)).toEqual([Infinity, Infinity, Infinity, 0, 1, 2]);
});
