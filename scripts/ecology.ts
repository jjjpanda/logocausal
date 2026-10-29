import { FOOD_START_AMOUNT, live, processTiming, step, HISTORY, W } from "../src/core/evolve";
import type { Energy, World } from "../src/core/evolve";
import { randomModel, remapState, seededRandom } from "../src/core/model";
import { influences } from "../src/core/info";
import { analyze } from "../src/core/recursion";
import { place, settle } from "../src/core/physics";
import type { Bodies } from "../src/core/physics";
import { writeFileSync } from "node:fs";

const positiveInteger = (name: string, fallback: number) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
};
const seeds = positiveInteger("ECOLOGY_SEEDS", 20);
const horizon = positiveInteger("ECOLOGY_TICKS", 3000);
if (horizon < HISTORY) throw new Error(`ECOLOGY_TICKS must be at least ${HISTORY}`);
const noise = Number(process.env.ECOLOGY_NOISE ?? 0.002);
if (!Number.isFinite(noise) || noise < 0 || noise > 1) throw new Error("ECOLOGY_NOISE must be between 0 and 1");

// Full ecology, including movement. Same 20 physics substeps per tick as the app.
const runs = Array.from({ length: seeds }, (_, i) => {
  const rng = seededRandom(i + 1);
  let model = randomModel(6, i + 1);
  let history = [Math.floor(rng() * 64)];
  let energy: Energy = {};
  let world: World = { sun: W / 2, food: [
    { x: W / 2 - 550, y: 240, amount: FOOD_START_AMOUNT },
    { x: W / 2, y: 600, amount: FOOD_START_AMOUNT },
    { x: W / 2 + 550, y: 240, amount: FOOD_START_AMOUNT },
  ] };
  const bodies: Bodies = new Map();
  let scored = model;
  let tiers = analyze(model);
  let matrix = influences(model);
  let births = 0, deaths = 0, ticks = 0;
  let lateBirths = 0, loopTicks = 0, lateLoopTicks = 0, activeTicks = 0, samples = 0, entropy = 0;
  let distance = 0, bodyTicks = 0, topologyChanges = 0;
  const states = new Set<string>();
  // Seed placement as well as evolutionary events.
  const originalRandom = Math.random;
  const originalUUID = crypto.randomUUID;
  let serial = 0;
  Math.random = rng;
  // IDs affect spring lengths. Seed them too, without consuming evolutionary randomness.
  crypto.randomUUID = (() => `00000000-0000-4000-8000-${String(++serial).padStart(12, "0")}`) as typeof crypto.randomUUID;
  try {
    for (; ticks < horizon && model.nodes.length; ticks++) {
      place(model, bodies, world);
      if (model !== scored) { tiers = analyze(model); matrix = influences(model); scored = model; }
      const previous = model.nodes.map(n => ({ ...bodies.get(n.id)! }));
      for (let frame = 0; frame < 20; frame++) settle(model, matrix, bodies, history.at(-1)!, world);
      model.nodes.forEach((n, j) => { distance += Math.hypot(bodies.get(n.id)!.x - previous[j].x, bodies.get(n.id)!.y - previous[j].y); bodyTicks++; });
      const locate = (id: string) => bodies.get(id)!;
      const timing = processTiming(model, history, world, locate);
      history = [...history, step(model, history, world, locate, noise, rng, timing)].slice(-HISTORY);
      const next = live(model, tiers, history, energy, world, locate, rng, timing);
      births += next.events.filter(e => e.kind === "born").length;
      if (ticks >= horizon / 2) lateBirths += next.events.filter(e => e.kind === "born").length;
      deaths += next.events.filter(e => e.kind === "died").length;
      if (next.model !== model) topologyChanges++;
      if (history.length === HISTORY) {
        // Entropy measures variation, not intelligence or causal complexity.
        const budgets = next.budgets;
        const live = budgets.some(b => b.loop > 0.012 * b.rate * 0.05);
        if (live) { loopTicks++; if (ticks >= horizon / 2) lateLoopTicks++; }
        if (history.at(-1)) activeTicks++;
        const h = model.nodes.map((_, j) => {
          const p = history.filter(s => (s >>> j) & 1).length / history.length;
          return p === 0 || p === 1 ? 0 : -p * Math.log2(p) - (1 - p) * Math.log2(1 - p);
        });
        entropy += h.reduce((a, b) => a + b, 0) / h.length;
        samples++;
        states.add(`${model.nodes.map(n => n.id).join(",")}:${history.at(-1)}`);
      }
      history = history.map(state => remapState(state, model, next.model));
      ({ model, energy, world } = next);
      const present = new Set(model.nodes.map(n => n.id));
      for (const id of bodies.keys()) if (!present.has(id)) bodies.delete(id);
    }
  } finally { Math.random = originalRandom; crypto.randomUUID = originalUUID; }
  const result = { seed: i + 1, ticks, population: model.nodes.length, births, deaths, lateBirths, topologyChanges,
    activeFraction: activeTicks / (horizon - HISTORY + 2),
    liveLoopFraction: loopTicks / (horizon - HISTORY + 2),
    lateLoopFraction: lateLoopTicks / Math.ceil(horizon / 2),
    activityEntropy: samples ? entropy / samples : 0,
    meanTravel: bodyTicks ? distance / bodyTicks : 0, distinctStates: states.size };
  console.log(`Seed ${i + 1}/${seeds}: ${ticks} ticks, ${result.population} alive, ${births} births (${lateBirths} in second half)`);
  return result;
});
console.table(runs);
const summary = { survived: runs.filter(r => r.population > 0).length, runs: runs.length, horizon, noise,
  meanLifetime: runs.reduce((s, r) => s + r.ticks, 0) / runs.length,
  births: runs.reduce((s, r) => s + r.births, 0), lateBirths: runs.reduce((s, r) => s + r.lateBirths, 0),
  meanLiveLoopFraction: runs.reduce((s, r) => s + r.liveLoopFraction, 0) / runs.length,
  meanLateLoopFraction: runs.reduce((s, r) => s + r.lateLoopFraction, 0) / runs.length,
  meanActivityEntropy: runs.reduce((s, r) => s + r.activityEntropy, 0) / runs.length,
  meanTravel: runs.reduce((s, r) => s + r.meanTravel, 0) / runs.length };
console.log(JSON.stringify(summary));
if (process.env.ECOLOGY_OUTPUT) writeFileSync(process.env.ECOLOGY_OUTPUT, JSON.stringify({ summary, runs }, null, 2) + "\n");
