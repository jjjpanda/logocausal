import { describe, expect, it } from "vitest";
import { outline } from "../components/NetworkGraph";
import { ENERGY_CAP, FEED_RANGE, FOOD_SPACING, FOOD_START_AMOUNT, H, LIGHT_RANGE, LINK_RANGE, MAX_FOOD, MAX_FOOD_AMOUNT, MAX_POPULATION, MIN_NODES, SENSE_RANGE, SPLIT_ENERGY, START_ENERGY, W, adaptNetwork, feedRadius, fitness, live, metabolism, motorVectors, processTiming, resizeWorld, shareEnergy, spawnFoodNearSun, step, sunAt, temperature, tired } from "./evolve";
import type { Energy, Locate, World } from "./evolve";
import { fixtureModel } from "./fixtures";
import { randomModel, remapState, seededRandom } from "./model";
import type { NetworkModel } from "./model";
import { analyze } from "./recursion";

const middle: Locate = () => ({ x: W / 2, y: 200 });
const coldSpot: Locate = () => ({ x: W - 50, y: H - 50 });
const world: World = { sun: W / 2, food: [{ x: W / 2, y: 200, amount: 1 }] };

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
    expect(step(model, [0], { ...world, food: [] }, coldSpot, 0) & 0b11).toBe(0);
  });

  it("slows metabolism in cold areas without cold damage", () => {
    const model = fixtureModel("independent");
    const unfed = { ...world, food: [] };
    const warm = metabolism(model, null, [0], unfed, middle);
    const cold = metabolism(model, null, [0], unfed, coldSpot);
    expect(cold[0].exposure).toBe(0);
    expect(cold[0].delta).toBeLessThan(0);
    expect(cold[0].delta).toBeCloseTo(warm[0].delta * 0.1);
    expect(temperature(world, sunAt(world), [0], 0)).toBeGreaterThan(0.85);
  });

  it("still starves without food, but lasts longer when cold", () => {
    const lifespan = (locate: Locate) => {
      let model = fixtureModel("independent");
      let w: World = { ...world, food: [] };
      let energy: Energy = {};
      for (let ticks = 1; ticks <= 2000; ticks++) {
        const result = live(model, null, [0, 0], energy, w, locate, () => 0.99);
        if (!result.model.nodes.length) {
          expect(result.events.every(e => e.cause === "starved")).toBe(true);
          return ticks;
        }
        model = result.model;
        energy = result.energy;
        w = { ...result.world, sun: world.sun, food: [] };
      }
      throw new Error("Unfed neurons failed to starve");
    };
    expect(lifespan(coldSpot)).toBeGreaterThan(lifespan(middle) * 5);
  });

  it("retains a cold signal between local updates and only counts actual firings for heat and fatigue", () => {
    const model = { ...fixtureModel("independent"), nodes: [
      { id: "cold", label: "A", inputs: [], table: [0], sense: "food" as const },
    ] };
    let w: World = { ...world, food: [{ ...coldSpot(""), amount: 2.5 }] };
    let history = [0];
    let energy: Energy = {};
    for (let tick = 1; tick <= 11; tick++) {
      const timing = processTiming(model, history, w, coldSpot);
      const next = step(model, history, w, coldSpot, 0, () => 0.99, timing);
      history = [...history, next];
      const result = live(model, null, history, energy, w, coldSpot, () => 0.99, timing);
      w = { ...result.world, sun: world.sun };
      energy = result.energy;
      if (tick < 10) expect(next).toBe(0);
      else expect(next).toBe(1);
    }
    expect(w.processes!.cold.streak).toBe(1);
    expect(temperature(w, coldSpot(""), history, 0, "cold")).toBeCloseTo(0.06);
    // A cold cell's food intake and upkeep both remain slow.
    expect(energy.cold).toBeLessThan(START_ENERGY + 0.1);
  });

  it("slows feeding, sharing, reproduction and rewiring in the cold", () => {
    const model = fixtureModel("independent");
    const coldFood = { ...world, food: [{ ...coldSpot(""), amount: 2.5 }] };
    const cold = metabolism(model, null, [1], coldFood, coldSpot);
    const warm = metabolism(model, null, [1], world, middle);
    expect(cold[0].intake).toBeCloseTo(warm[0].intake * cold[0].rate);
    const linked = fixtureModel("oneway");
    expect(shareEnergy(linked, [1, 0], middle, [0.1, 0.1])[1]).toBeCloseTo(shareEnergy(linked, [1, 0], middle)[1] * 0.1);
    const rich = { [model.nodes[0].id]: SPLIT_ENERGY + 0.5 };
    expect(live(model, null, [0], rich, world, coldSpot, () => 0.99).events).toEqual([]);
    expect(live(model, null, [0], rich, world, middle, () => 0.99).events.some(e => e.kind === "born")).toBe(true);
    const slow = live(model, null, [0], {}, world, coldSpot, () => 0.003);
    const fast = live(model, null, [0], {}, world, middle, () => 0.003);
    expect(slow.model.nodes.every(n => n.inputs.length === 0)).toBe(true);
    expect(fast.model.nodes.some(n => n.inputs.length > 0)).toBe(true);
  });

  it("moves the light clockwise along the edge", () => {
    expect(sunAt({ ...world, sun: 0 })).toEqual({ x: 0, y: 0 });
    expect(sunAt({ ...world, sun: W + 10 })).toEqual({ x: W, y: 10 });
    expect(sunAt({ ...world, sun: 2 * W + H + 10 })).toEqual({ x: 0, y: H - 10 });
    expect(live(fixtureModel("forager"), null, [0], {}, world, middle).world.sun).toBeGreaterThan(world.sun);
  });

  it.each([{ width: 2800, height: 1000 }, { width: 600, height: 1000 }])("keeps the sun on every edge of a resized habitat: %o", bounds => {
    const { width, height } = bounds;
    const resized = resizeWorld(world, bounds);
    expect(resized.food[0].x).toBeCloseTo(width / 2);
    const cases = [
      { sun: width / 2, point: { x: width / 2, y: 0 } },
      { sun: width + height / 2, point: { x: width, y: height / 2 } },
      { sun: width * 1.5 + height, point: { x: width / 2, y: height } },
      { sun: width * 2 + height * 1.5, point: { x: 0, y: height / 2 } },
    ];
    for (const { sun, point } of cases) expect(sunAt({ ...resized, sun })).toEqual(point);
    const wrapped = live({ ...fixtureModel("independent"), nodes: [] }, null, [0], {},
      { ...resized, sun: 2 * (width + height) - 1 }, middle, () => 0.99).world;
    expect(sunAt(wrapped)).toEqual({ x: 2, y: 0 });
  });

  it("shares conservatively through links, with twice the transfer at half the distance", () => {
    const model = fixtureModel("oneway");
    const atDistance = (distance: number): Locate => id => ({ x: id === model.nodes[0].id ? 0 : distance, y: 0 });
    const short = shareEnergy(model, [1, 0], atDistance(100));
    const long = shareEnergy(model, [1, 0], atDistance(200));
    expect(short[1]).toBeGreaterThan(0);
    expect(short[1]).toBeCloseTo(long[1] * 2);
    expect(short[0] + short[1]).toBeCloseTo(0);
    expect(shareEnergy(model, [1, 1], atDistance(100))).toEqual([0, 0]);
    expect(shareEnergy(model, [0, 1], atDistance(100))[0]).toBeCloseTo(short[1]);
    const reciprocal = { ...model, nodes: model.nodes.map((n, i) => i === 0 ? { ...n, inputs: [1], table: [0, 1] } : n) };
    expect(shareEnergy(reciprocal, [1, 0], atDistance(100))).toEqual(short);
    expect(shareEnergy(fixtureModel("independent"), [1, 0, 0], middle)).toEqual([0, 0, 0]);
  });

  it("caps donors across multiple short links and does not depend on node order", () => {
    const model = randomModel(6, 1);
    model.nodes = model.nodes.map((n, i) => ({ ...n, inputs: i ? [0] : [], table: i ? [0, 1] : [0] }));
    const balances = [1, 0, 0, 0, 0, 0];
    const shared = shareEnergy(model, balances, middle);
    expect(shared[0]).toBeCloseTo(-0.1);
    expect(shared.reduce((sum, v) => sum + v, 0)).toBeCloseTo(0);
    expect(shared.every((v, i) => balances[i] + v >= 0)).toBe(true);
    const reversed = { ...model, nodes: [...model.nodes].reverse().map(n => ({ ...n, inputs: n.inputs.map(j => model.nodes.length - j - 1) })) };
    const reordered = shareEnergy(reversed, [...balances].reverse(), middle).reverse();
    shared.forEach((v, i) => expect(reordered[i]).toBeCloseTo(v));
  });

  it("can rescue a starving linked neuron before death and records its sharing budget", () => {
    const model = fixtureModel("oneway");
    const energy = { [model.nodes[0].id]: 1, [model.nodes[1].id]: 0 };
    const result = live(model, null, [0], energy, { ...world, food: [] }, middle, () => 0.99);
    expect(result.events).toEqual([]);
    expect(result.model.nodes).toHaveLength(2);
    expect(result.energy[model.nodes[1].id]).toBeGreaterThan(0);
    expect(result.budgets[1].sharing).toBeGreaterThan(0);
    result.budgets.forEach((b, i) => expect(result.energy[model.nodes[i].id]).toBeCloseTo(energy[model.nodes[i].id] + b.delta));
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
    expect(result.budgets.reduce((total, budget) => total + budget.intake, 0)).toBeGreaterThan(0);
    expect(feedRadius({ amount: 0.8 })).toBeLessThan(FEED_RANGE);
    expect(result.energy[model.nodes[0].id]).toBeGreaterThan(1);

    const outerFoodWorld: World = {
      sun: W / 2,
      food: [{ x: W / 2 + FEED_RANGE + 30, y: 200, amount: 1 }],
    };
    expect(step(model, [0], outerFoodWorld, middle, 0) & 0b1).toBe(1);
    const outerResult = live(model, null, [0b11111], {}, outerFoodWorld, middle, seededRandom(1));
    expect(outerResult.world.food[0].amount).toBeGreaterThanOrEqual(1);
    expect(feedRadius({ amount: MAX_FOOD_AMOUNT })).toBe(feedRadius({ amount: 1.4 }));

    const spawned = spawnFoodNearSun(world, seededRandom(2));
    expect(spawned).toBeDefined();
    if (!spawned) throw new Error("Expected room for a food patch");
    expect(Math.hypot(spawned.x - W / 2, spawned.y)).toBeLessThan(LIGHT_RANGE);
  });

  it("moves each active motor toward food it can smell or comfortable light", () => {
    const model = fixtureModel("forager");
    const directedWorld: World = {
      sun: W / 2,
      food: [{ x: W / 2 + 120, y: 200, amount: 1 }],
    };
    expect(motorVectors(model, 0, directedWorld, middle).every(v => v.x === 0 && v.y === 0)).toBe(true);
    const towardFood = motorVectors(model, 1 << 2, directedWorld, middle)[2];
    expect(towardFood.x).toBeGreaterThan(0);
    expect(towardFood.y).toBeCloseTo(0);
    const towardLight = motorVectors(model, 1 << 4, directedWorld, middle)[4];
    expect(towardLight.y).toBeGreaterThan(0); // Too close: retreat into the comfortable light band.
    expect(motorVectors(model, 1 << 4, directedWorld, () => ({ x: W / 2, y: LIGHT_RANGE * 0.6 }))[4].y).toBeLessThan(0);
    const separated: Locate = id => id === model.nodes[2].id ? { x: W - 50, y: H - 50 } : middle(id);
    // Other neurons' knowledge of food does not give a motor distant vision.
    expect(motorVectors(model, 1 << 2, directedWorld, separated)[2]).toEqual({ x: 0, y: 0 });
  });

  it("shares scarce food synchronously without creating energy or favoring node order", () => {
    const model = fixtureModel("independent");
    const scarce = { ...world, food: [{ x: W / 2, y: 200, amount: 0.03 }] };
    const budgets = metabolism(model, null, [0b111], scarce, middle);
    budgets.forEach(b => expect(b.intake).toBeCloseTo(0.01));
    expect(budgets.reduce((s, b) => s + b.intake, 0)).toBeCloseTo(0.03);
    expect(scarce.food[0].amount).toBe(0.03);
    const next = live(model, null, [0b111], {}, scarce, middle, () => 0.99);
    expect(next.budgets.reduce((total, budget) => total + budget.intake, 0)).toBeCloseTo(0.03);
    expect(next.world.food[0].amount).toBeGreaterThan(0); // Replenishes after the shared meal.
  });

  it("allows a fed active neuron to gain energy and keeps food bounded", () => {
    const model = fixtureModel("forager");
    const budgets = metabolism(model, analyze(model), [5, 10, 5, 10, 5], world, middle);
    expect(budgets[0].delta).toBeGreaterThan(0);
    let growing = { ...world, food: [{ x: W / 2, y: 200, amount: 2.5 }] };
    for (let k = 0; k < 100; k++) growing = live({ ...model, nodes: [] }, null, [0], {}, growing, middle, () => 0).world;
    expect(growing.food.length).toBeLessThanOrEqual(MAX_FOOD);
    expect(growing.food.every(f => f.amount <= MAX_FOOD_AMOUNT)).toBe(true);
  });

  it("replenishes a grazed patch without expanding its mature feeding zone", () => {
    const empty = { ...fixtureModel("independent"), nodes: [] };
    let w: World = { ...world, food: [{ x: W / 2, y: 200, amount: 1.6 }] };
    const feedingRadius = feedRadius(w.food[0]);
    // A steady feeding demand that exhausted the previous regrowth rate.
    for (let tick = 0; tick < 80; tick++) {
      w = live(empty, null, [0], {}, w, middle, () => 0.99).world;
      w = { ...w, food: w.food.map((f, i) => i ? f : { ...f, amount: f.amount - 0.04 }) };
    }
    expect(w.food[0].amount).toBeGreaterThan(1.6);
    expect(feedRadius(w.food[0])).toBe(feedingRadius);
  });

  it("leaves room for mature feeding zones and skips spawning in a crowded habitat", () => {
    const rng = seededRandom(24);
    let w: World = { sun: W / 2, food: [] };
    const empty = { ...fixtureModel("independent"), nodes: [] };
    for (let tick = 0; tick < 1800; tick++) {
      w = live(empty, null, [0], {}, w, middle, rng).world;
      expect(w.food.length).toBeLessThanOrEqual(MAX_FOOD);
      for (let i = 0; i < w.food.length; i++) for (let j = i + 1; j < w.food.length; j++) {
        expect(Math.hypot(w.food[i].x - w.food[j].x, w.food[i].y - w.food[j].y)).toBeGreaterThanOrEqual(FOOD_SPACING);
      }
    }
    expect(w.food.length).toBeGreaterThan(1);
    const packed: World = { sun: 150, bounds: { width: 300, height: 300 }, food: [{ x: 150, y: 150, amount: 1 }] };
    expect(spawnFoodNearSun(packed, rng)).toBeUndefined();
    const compressed = resizeWorld({ ...world, food: [{ x: 300, y: 300, amount: 1 }, { x: 1300, y: 300, amount: 1 }] }, { width: 400, height: H });
    expect(compressed.food).toHaveLength(1);
  });

  it("lets heavy grazing deplete a patch and lets it recover when grazing stops", () => {
    const model: NetworkModel = { ...fixtureModel("independent"), nodes: Array.from({ length: MAX_POPULATION }, (_, i) => ({
      id: `hungry-${i}`, label: String.fromCharCode(65 + i), inputs: [], table: [1],
    })) };
    let w: World = { sun: W / 2, food: [{ ...middle(""), amount: FOOD_START_AMOUNT }] };
    const allOn = (1 << MAX_POPULATION) - 1;
    let lastIntake = 0;
    for (let tick = 0; tick < 30; tick++) {
      // Fixed consumers and light isolate resource feedback from deaths and migration.
      const result = live(model, null, [allOn], {}, { ...w, sun: W / 2 }, middle, () => 0.99);
      w = result.world;
      lastIntake = result.budgets[0].intake;
    }
    expect(w.food[0].amount).toBeLessThan(FOOD_START_AMOUNT / 4);
    expect(lastIntake).toBeLessThan(0.075 / 2);
    for (let tick = 0; tick < 80; tick++)
      w = live({ ...model, nodes: [] }, null, [0], {}, { ...w, sun: W / 2 }, middle, () => 0.99).world;
    expect(w.food[0].amount).toBeGreaterThan(FOOD_START_AMOUNT);
    expect(w.food[0].amount).toBeLessThanOrEqual(MAX_FOOD_AMOUNT);
  });

  it("charges for local crowding rather than distant population", () => {
    const model = randomModel(14, 8);
    const dispersed: Locate = id => ({ x: 50 + model.nodes.findIndex(n => n.id === id) * 300, y: 400 });
    const dense = metabolism(model, null, [0], world, middle);
    const sparse = metabolism(model, null, [0], world, dispersed);
    expect(dense[0].upkeep / dense[0].rate).toBeGreaterThan(sparse[0].upkeep / sparse[0].rate * 3);
  });

  it("cannot live on loop rewards alone", () => {
    const model = fixtureModel("overlap");
    const budgets = metabolism(model, analyze(model), run(model, 96, seededRandom(2)), { ...world, food: [] }, middle);
    expect(budgets.some(b => b.loop > 0)).toBe(true);
    budgets.forEach(b => { expect(b.loop).toBeLessThanOrEqual(b.upkeep * 0.6); expect(b.delta).toBeLessThan(0); });
  });

  it("lets quiet neurons graze slowly and subtracts their intake from the actual patch", () => {
    const model = fixtureModel("independent");
    const on = metabolism(model, null, [0b111], world, middle);
    const off = metabolism(model, null, [0], world, middle);
    off.forEach((b, i) => expect(b.intake).toBeCloseTo(on[i].intake / 5));
    const scarce = { ...world, food: [{ ...middle(""), amount: 0.03 }] };
    const result = live(model, null, [0], {}, scarce, middle, () => 0.99);
    expect(result.budgets.reduce((s, b) => s + b.intake, 0)).toBeCloseTo(0.03);
    // Growth starts from the depleted stock, not from its pre-meal value.
    const grown = live({ ...model, nodes: [] }, null, [0], {}, { ...scarce, food: [{ ...middle(""), amount: 0 }] }, middle, () => 0.99);
    expect(result.world.food).toEqual(grown.world.food);
  });

  it("grows new dendrites locally and makes quiet neurons more likely to change gates", () => {
    const model = fixtureModel("oneway");
    const distant: Locate = id => ({ x: id === model.nodes[0].id ? 0 : LINK_RANGE + 1, y: 300 });
    const rng = seededRandom(47);
    let nearbyGrowth = 0, quietChanges = 0, variedChanges = 0;
    for (let trial = 0; trial < 4000; trial++) {
      const far = adaptNetwork(model, [0], distant, rng, new Map());
      expect(far.nodes[0].inputs).toHaveLength(0);
      nearbyGrowth += Number(adaptNetwork(model, [0], middle, rng, new Map()).nodes[0].inputs.length > 0);
      quietChanges += Number(adaptNetwork(model, Array(96).fill(0), middle, rng, new Map()).nodes[1].table[0] !== model.nodes[1].table[0]);
      variedChanges += Number(adaptNetwork(model, Array.from({ length: 96 }, (_, i) => i % 2 ? 3 : 0), middle, rng, new Map()).nodes[1].table[0] !== model.nodes[1].table[0]);
    }
    expect(nearbyGrowth).toBeGreaterThan(0);
    expect(quietChanges).toBeGreaterThan(variedChanges * 3);
  });

  it("preferentially prunes an input that never changes over an influential varying input", () => {
    const model = fixtureModel("overlap");
    // B = A XOR C. A varies, C is frozen; both matter in the truth table.
    model.nodes[1].table = [0, 1, 1, 0];
    const history = Array.from({ length: 96 }, (_, i) => i % 2 ? 1 : 0);
    const rng = seededRandom(82);
    let pruned = 0;
    for (let trial = 0; trial < 500; trial++) {
      const next = adaptNetwork(model, history, middle, rng, new Map()).nodes[1];
      if (next.inputs.length === 1) { expect(next.inputs).toEqual([0]); pruned++; }
    }
    expect(pruned).toBeGreaterThan(0);
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

  it("usually inherits the parent's rule, preserves readers' gates and conserves division energy", () => {
    const model = fixtureModel("overlap");
    const balances = Object.fromEntries(model.nodes.map((node, i) => [node.id, i === 0 ? 3 : START_ENERGY]));
    const result = live(model, null, [0], balances, world, middle, () => 0.99);
    const child = result.model.nodes.at(-1)!;
    expect(result.events).toContainEqual({ kind: "born", label: "A2", parent: "A" });
    expect(child.inputs).toEqual(model.nodes[0].inputs);
    expect(child.table).toEqual(model.nodes[0].table);
    model.nodes.forEach((node, i) => {
      expect(result.model.nodes[i].table).toEqual(node.table);
      expect(result.model.nodes[i].inputs).toHaveLength(node.inputs.length);
    });
    expect(result.model.nodes[1].inputs).toContain(result.model.nodes.length - 1);
    expect(Object.values(result.energy).reduce((a, b) => a + b, 0)).toBeCloseTo(
      Object.values(balances).reduce((a, b) => a + b, 0) + result.budgets.reduce((sum, b) => sum + b.delta, 0));
    expect(result.energy[child.id]).toBe(result.energy[model.nodes[0].id]);
  });

  it("bounds stored energy and accounts for discarded surplus when the population is full", () => {
    const model = randomModel(MAX_POPULATION, 9);
    const initial = Object.fromEntries(model.nodes.map(n => [n.id, ENERGY_CAP + 1]));
    const result = live(model, null, [0], initial, world, middle, () => 0.99);
    expect(result.events).toHaveLength(0);
    result.budgets.forEach((b, i) => {
      expect(b.overflow).toBeGreaterThan(0);
      expect(result.energy[model.nodes[i].id]).toBe(ENERGY_CAP);
      expect(initial[model.nodes[i].id] + b.delta).toBeCloseTo(ENERGY_CAP);
    });
  });

  it("kills neurons out of energy, names the cause, and keeps the minimum", () => {
    const model = randomModel(6, 9);
    const energy = Object.fromEntries(model.nodes.map((node) => [node.id, 0]));
    const { model: next, events } = live(model, null, [0], energy, world, coldSpot, seededRandom(1));
    expect(next.nodes).toHaveLength(MIN_NODES);
    const died = events.filter((e) => e.kind === "died");
    expect(died).toHaveLength(6 - MIN_NODES);
    expect(died.every((e) => e.cause === "starved")).toBe(true);
  });

  it("handles empty or overlapping point sets in group outlines without crashing", () => {
    expect(outline([], 20)).toBe("");
    expect(outline([{ x: 100, y: 100 }, { x: 100, y: 100 }], 20)).toContain("A 20,20");
  });
});
