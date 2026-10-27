import { letter, makeNode, makeSensor } from "./model";
import type { NetworkModel, Sense } from "./model";

const node = (i: number, inputs: number[], table: number[]) => makeNode(`node-${i}`, letter(i), inputs, table);
const sensor = (i: number, sense: Sense) => makeSensor(`node-${i}`, letter(i), sense);
const net = (name: string, nodes: NetworkModel["nodes"]): NetworkModel => ({ version: 1, name, seed: 42, nodes });

export const fixtures: { id: string; title: string; model: NetworkModel }[] = [
  {
    id: "forager",
    title: "Forager",
    model: net("Forager", [
      sensor(0, "food"),
      sensor(1, "light"),
      node(2, [0, 3], [0, 1, 1, 1]),
      node(3, [2], [0, 1]),
      node(4, [1], [1, 0]),
    ]),
  },
  {
    id: "independent",
    title: "Independent bits",
    model: net("Independent bits", Array.from({ length: 3 }, (_, i) => node(i, [i], [0, 1]))),
  },
  {
    id: "clusters",
    title: "Separated clusters",
    model: net("Separated clusters", [node(0, [1], [0, 1]), node(1, [0], [0, 1]), node(2, [3], [0, 1]), node(3, [2], [0, 1])]),
  },
  {
    id: "overlap",
    title: "Overlap chain",
    model: net("Overlap chain", [node(0, [1], [0, 1]), node(1, [0, 2], [0, 1, 1, 1]), node(2, [1], [0, 1])]),
  },
  {
    id: "oneway",
    title: "One-way influence",
    model: net("One-way influence", [node(0, [0], [0, 1]), node(1, [0], [0, 1])]),
  },
];

export function fixtureModel(id: string): NetworkModel {
  const fixture = fixtures.find((f) => f.id === id);
  if (!fixture) throw new Error(`Unknown fixture: ${id}`);
  return structuredClone(fixture.model);
}
