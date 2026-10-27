import { describe, expect, it } from "vitest";
import { outline } from "../components/NetworkGraph";
import { FEED_RANGE, H, MAX_POPULATION, MIN_NODES, SENSE_RANGE, SPLIT_ENERGY, W, feedRadius, fitness, live, pushVector, spawnFoodNearSun, step, sunAt, temperature, tired } from "./evolve";
import type { Energy, Locate, World } from "./evolve";
import { fixtureModel } from "./fixtures";
import { randomModel, remapState, seededRandom } from "./model";
import type { NetworkModel } from "./model";
import { analyze } from "./recursion";

const middle: Locate = () => ({ x: W / 2, y: 200 });
const world: World = { lit: true, sun: W / 2, food: [{ x: W / 2, y: 200, amount: 1 }] };

const run = (model: NetworkModel, ticks: number, rng: () => number, noise = 0.05) => {
  const history = [5];
  while (history.length < ticks) history.push(step(model, history, world, middle, noise, rng));
  return history;
};

describe("life", () => {
  it("rests a neuron that fired FATIGUE ticks in a row", () => {
    const always = {
      ...fixtureModel("independent"),
      nodes: fixtureModel("independent").nodes.map((n) => ({ ...n, inputs: [], table: [0], sense: "light" as const })),
    };
    const history = run(always, 8, () => 0.99, 0);
    expect(history.map((s) => s & 1)).toEqual([1, 1, 1, 0, 1, 1, 1, 0]);
    expect(tired([1, 1, 1], 0)).toBe(true);
  });

  it("senses food and light at the neuron's spot", () => {
    const model = fixtureModel("forager");
    const next = step(model, [0], world, middle, 0);
    expect(next & 0b11).toBe(0b11);
    expect(step(model, [0], { ...world, lit: false, food: [] }, middle, 0) & 0b11).toBe(0);
  });

  it("freezes in the dark even when firing", () => {
    const dark = { ...world, lit: false };
    expect(temperature(dark, middle(""), [1, 1, 1, 0], 0)).toBeLessThan(0.25);
    expect(temperature(world, sunAt(world), [0], 0)).toBeGreaterThan(0.85);
  });

  it("moves the light clockwise along the edge", () => {
    expect(sunAt({ ...world, sun: 0 })).toEqual({ x: 0, y: 0 });
    expect(sunAt({ ...world, sun: W + 10 })).toEqual({ x: W, y: 10 });
    expect(sunAt({ ...world, sun: 2 * W + H + 10 })).toEqual({ x: 0, y: H - 10 });
    expect(live(fixtureModel("forager"), null, [0], {}, world, middle).world.sun).toBeGreaterThan(world.sun);
  });

  it("grows dendrites at random", () => {
    let model = fixtureModel("independent");
    const rng = seededRandom(5);
    for (let k = 0; k < 400; k++) model = live(model, null, [0], {}, world, middle, rng).model;
    expect(model.nodes.some((node) => node.inputs.length > 1)).toBe(true);
  });

  it("pays neurons for loops that are live in the run", () => {
    const model = fixtureModel("overlap");
    const [a, b] = fitness(model, analyze(model), run(model, 96, seededRandom(2)));
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThanOrEqual(a);
    expect(fitness(model, analyze(model), [0, 0, 0, 0])).toEqual([0, 0, 0]);
  });

  it("feeds firing neurons near food, shrinks feed radius, and senses food from a larger radius", () => {
    expect(SENSE_RANGE).toBeGreaterThan(FEED_RANGE);
    const model = fixtureModel("forager");
    const result = live(model, null, [0b11111], {}, world, middle, seededRandom(1));
    expect(result.world.food[0].amount).toBeLessThan(1);
    expect(feedRadius(result.world.food[0])).toBeLessThan(FEED_RANGE);
    expect(result.energy[model.nodes[0].id]).toBeGreaterThan(1);

    const outerFoodWorld: World = {
      lit: true,
      sun: W / 2,
      food: [{ x: W / 2 + FEED_RANGE + 30, y: 200, amount: 1 }],
    };
    expect(step(model, [0], outerFoodWorld, middle, 0) & 0b1).toBe(1);
    const outerResult = live(model, null, [0b11111], {}, outerFoodWorld, middle, seededRandom(1));
    expect(outerResult.world.food[0].amount).toBeGreaterThanOrEqual(1);
    expect(feedRadius({ amount: 2.5 })).toBeGreaterThan(FEED_RANGE * 2);

    const spawned = spawnFoodNearSun(world, seededRandom(2));
    expect(Math.hypot(spawned.x - W / 2, spawned.y)).toBeLessThan(680);
  });

  it("pushes the system toward sensed food or light only when push neurons are on", () => {
    const model = fixtureModel("forager");
    const directedWorld: World = {
      lit: true,
      sun: W / 2,
      food: [{ x: W / 2 + 120, y: 200, amount: 1 }],
    };
    expect(pushVector(model, 0, directedWorld, middle)).toEqual({ x: 0, y: 0 });
    const towardFood = pushVector(model, 1 << 2, directedWorld, middle);
    expect(towardFood.x).toBeGreaterThan(0);
    expect(towardFood.y).toBeCloseTo(0);
    const towardLight = pushVector(model, 1 << 4, directedWorld, middle);
    expect(towardLight.y).toBeLessThan(0);
  });

  it("keeps the network valid and within bounds over many ticks", () => {
    const rng = seededRandom(3);
    let model = fixtureModel("forager");
    let energy: Energy = {};
    let w = world;
    let history = [5];
    for (let k = 0; k < 600; k++) {
      history = [...history, step(model, history, w, middle, 0.02, rng)].slice(-96);
      const result = live(model, analyze(model), history, energy, w, middle, rng);
      history = history.map((s) => remapState(s, model, result.model));
      ({ model, energy, world: w } = result);
      expect(model.nodes.length).toBeLessThanOrEqual(MAX_POPULATION);
      expect(model.nodes.length).toBeGreaterThanOrEqual(MIN_NODES);
      expect(Object.keys(energy).sort()).toEqual(model.nodes.map((node) => node.id).sort());
    }
  }, 60_000);

  it("splits a rich neuron into a clone of its family", () => {
    const model = fixtureModel("overlap");
    const energy = { [model.nodes[1].id]: SPLIT_ENERGY * 2 };
    const { model: next, events } = live(model, analyze(model), run(model, 96, seededRandom(4)), energy, world, middle, seededRandom(1));
    const child = next.nodes[next.nodes.length - 1];
    expect(events).toContainEqual({ kind: "born", label: child.label, parent: "B" });
    expect(child.label).toBe("B2");
  });

  it("kills neurons out of energy, names the cause, and keeps the minimum", () => {
    const model = randomModel(6, 9);
    const energy = Object.fromEntries(model.nodes.map((node) => [node.id, 0]));
    const { model: next, events } = live(model, null, [0], energy, { ...world, lit: false }, middle, seededRandom(1));
    expect(next.nodes).toHaveLength(MIN_NODES);
    const died = events.filter((e) => e.kind === "died");
    expect(died).toHaveLength(6 - MIN_NODES);
    expect(died.every((e) => e.cause === "froze")).toBe(true);
  });

  it("handles empty or overlapping point sets in group outlines without crashing", () => {
    expect(outline([], 20)).toBe("");
    expect(outline([{ x: 100, y: 100 }, { x: 100, y: 100 }], 20)).toContain("A 20,20");
  });
});
