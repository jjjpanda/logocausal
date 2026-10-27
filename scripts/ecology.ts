import { HISTORY } from "../src/core/evolve";
import { randomModel, seededRandom } from "../src/core/model";
import { influences } from "../src/core/info";
import { analyze, highestGroup } from "../src/core/recursion";
import { describeCircuits, describeMachine } from "../src/core/machine";
import { members } from "../src/core/model";
import { feedbackComponents } from "../src/core/topology";
import { initialWorld, tickSimulation } from "../src/core/simulation";
import type { SimulationState } from "../src/core/simulation";
import type { Bodies } from "../src/core/physics";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const positiveInteger = (name: string, fallback: number) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
};
const seeds = positiveInteger("ECOLOGY_SEEDS", 20);
const firstSeed = positiveInteger("ECOLOGY_START_SEED", 1);
if (firstSeed + seeds - 1 > 0xffffffff) throw new Error("The seed range must fit unsigned 32-bit integers");
const horizon = positiveInteger("ECOLOGY_TICKS", 3000);
if (horizon < HISTORY) throw new Error(`ECOLOGY_TICKS must be at least ${HISTORY}`);
const noise = Number(process.env.ECOLOGY_NOISE ?? 0.002);
if (!Number.isFinite(noise) || noise < 0 || noise > 1) throw new Error("ECOLOGY_NOISE must be between 0 and 1");
const sampleEvery = positiveInteger("ECOLOGY_SAMPLE_EVERY", 24);
const sourceFiles = ["model", "gates", "evolve", "physics", "info", "recursion", "machine", "simulation", "topology"];
const sourceSha256 = Object.fromEntries(sourceFiles.map(name => [name,
  createHash("sha256").update(readFileSync(`src/core/${name}.ts`)).digest("hex")]));

// Full ecology, including movement. Same 20 physics substeps per tick as the app.
const runs = Array.from({ length: seeds }, (_, i) => {
  const seed = firstSeed + i;
  const rng = seededRandom(seed);
  let model = randomModel(6, seed);
  let history = [Math.floor(rng() * 64)];
  let energy: SimulationState["energy"] = {};
  let world = initialWorld();
  const bodies: Bodies = new Map();
  let scored = model;
  let tiers = analyze(model);
  let matrix = influences(model);
  let births = 0, deaths = 0, ticks = 0;
  let lateBirths = 0, loopTicks = 0, lateLoopTicks = 0, activeTicks = 0, samples = 0, entropy = 0;
  let distance = 0, bodyTicks = 0, topologyChanges = 0;
  const states = new Set<string>();
  let mechanismSamples = 0, largerFeedbackSamples = 0, uncheckedSamples = 0, selectedChanges = 0;
  let previousSelection = "", maxCircuitSize = 0;
  let feedbackSamples = 0, largerCoreSamples = 0, feedbackSizeSum = 0, maxFeedbackSize = 0, longestCoreTicks = 0;
  const coreLifetimes = new Map<string, number>();
  const selectedTypes: Record<string, number> = {}, wholeTypes: Record<string, number> = {};
  // Seed placement as well as evolutionary events.
  const originalRandom = Math.random;
  const originalUUID = crypto.randomUUID;
  let serial = 0;
  Math.random = rng;
  // IDs affect spring lengths. Seed them too, without consuming evolutionary randomness.
  crypto.randomUUID = (() => `00000000-0000-4000-8000-${String(++serial).padStart(12, "0")}`) as typeof crypto.randomUUID;
  try {
    for (; ticks < horizon && model.nodes.length; ticks++) {
      if (model !== scored) { tiers = analyze(model); matrix = influences(model); scored = model; }
      const cores = feedbackComponents(model);
      const largestCore = Math.max(0, ...cores.map(mask => members(mask, model.nodes.length).length));
      feedbackSamples++;
      feedbackSizeSum += largestCore;
      maxFeedbackSize = Math.max(maxFeedbackSize, largestCore);
      if (largestCore >= 3) largerCoreSamples++;
      const presentCores = new Set<string>();
      for (const mask of cores) {
        const group = members(mask, model.nodes.length);
        if (group.length < 3) continue;
        const signature = JSON.stringify(group.map(i => {
          const node = model.nodes[i];
          return [node.id, node.inputs.map(j => model.nodes[j].id), node.table, node.sense];
        }).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
        presentCores.add(signature);
        const lifetime = (coreLifetimes.get(signature) ?? 0) + 1;
        coreLifetimes.set(signature, lifetime);
        longestCoreTicks = Math.max(longestCoreTicks, lifetime);
      }
      for (const signature of coreLifetimes.keys()) if (!presentCores.has(signature)) coreLifetimes.delete(signature);
      if (ticks % sampleEvery === 0) {
        mechanismSamples++;
        const selected = highestGroup(tiers);
        const machine = selected && describeMachine(model, selected.mask);
        const selectedType = machine?.name ?? "No group";
        selectedTypes[selectedType] = (selectedTypes[selectedType] ?? 0) + 1;
        const selection = selected ? `${members(selected.mask, model.nodes.length).map(i => model.nodes[i].id).sort().join(",")}:${selectedType}` : "none";
        if (previousSelection && selection !== previousSelection) selectedChanges++;
        previousSelection = selection;
        const circuits = describeCircuits(model);
        for (const circuit of circuits) {
          wholeTypes[circuit.machine.name] = (wholeTypes[circuit.machine.name] ?? 0) + 1;
          maxCircuitSize = Math.max(maxCircuitSize, members(circuit.mask, model.nodes.length).length);
        }
        if (circuits.some(circuit => circuit.machine.name !== "Logic circuit"
          && members(circuit.mask, model.nodes.length).length > (selected?.size ?? 0))) largerFeedbackSamples++;
        if (circuits.some(circuit => circuit.machine.name === "Feedback circuit")) uncheckedSamples++;
      }
      const previous = new Map([...bodies].map(([id, body]) => [id, { ...body }]));
      const next = tickSimulation({ model, history, energy, world }, bodies, tiers, rng, noise, matrix);
      model.nodes.forEach(node => {
        const before = previous.get(node.id), after = bodies.get(node.id)!;
        if (before) { distance += Math.hypot(after.x - before.x, after.y - before.y); bodyTicks++; }
      });
      history = next.signals;
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
      history = next.history;
      ({ model, energy, world } = next);
      const present = new Set(model.nodes.map(n => n.id));
      for (const id of bodies.keys()) if (!present.has(id)) bodies.delete(id);
    }
  } finally { Math.random = originalRandom; crypto.randomUUID = originalUUID; }
  const result = { seed, ticks, population: model.nodes.length, births, deaths, lateBirths, topologyChanges,
    activeFraction: activeTicks / (horizon - HISTORY + 2),
    liveLoopFraction: loopTicks / (horizon - HISTORY + 2),
    lateLoopFraction: lateLoopTicks / Math.ceil(horizon / 2),
    activityEntropy: samples ? entropy / samples : 0,
    meanTravel: bodyTicks ? distance / bodyTicks : 0, distinctStates: states.size,
    mechanisms: { samples: mechanismSamples, selectedTypes, wholeTypes, maxCircuitSize, selectedChanges,
      largerCoreFraction: largerCoreSamples / horizon, meanLargestCore: feedbackSamples ? feedbackSizeSum / feedbackSamples : 0,
      maxFeedbackSize, longestCoreTicks,
      largerFeedbackFraction: mechanismSamples ? largerFeedbackSamples / mechanismSamples : 0,
      uncheckedFraction: mechanismSamples ? uncheckedSamples / mechanismSamples : 0 } };
  console.log(`Seed ${seed} (${i + 1}/${seeds}): ${ticks} ticks, ${result.population} alive, ${births} births (${lateBirths} in second half)`);
  return result;
});
console.table(runs);
const summary = { survived: runs.filter(r => r.population > 0).length, runs: runs.length, firstSeed, horizon, noise, sampleEvery,
  meanLifetime: runs.reduce((s, r) => s + r.ticks, 0) / runs.length,
  births: runs.reduce((s, r) => s + r.births, 0), lateBirths: runs.reduce((s, r) => s + r.lateBirths, 0),
  meanLiveLoopFraction: runs.reduce((s, r) => s + r.liveLoopFraction, 0) / runs.length,
  meanLateLoopFraction: runs.reduce((s, r) => s + r.lateLoopFraction, 0) / runs.length,
  meanActivityEntropy: runs.reduce((s, r) => s + r.activityEntropy, 0) / runs.length,
  meanTravel: runs.reduce((s, r) => s + r.meanTravel, 0) / runs.length,
  meanLargerFeedbackFraction: runs.reduce((s, r) => s + r.mechanisms.largerFeedbackFraction, 0) / runs.length,
  meanUncheckedFraction: runs.reduce((s, r) => s + r.mechanisms.uncheckedFraction, 0) / runs.length,
  meanLargerCoreFraction: runs.reduce((s, r) => s + r.mechanisms.largerCoreFraction, 0) / runs.length,
  meanLargestCore: runs.reduce((s, r) => s + r.mechanisms.meanLargestCore, 0) / runs.length,
  meanLongestCoreTicks: runs.reduce((s, r) => s + r.mechanisms.longestCoreTicks, 0) / runs.length,
};
console.log(JSON.stringify(summary));
if (process.env.ECOLOGY_OUTPUT) writeFileSync(process.env.ECOLOGY_OUTPUT, JSON.stringify({ sourceSha256, summary, runs }, null, 2) + "\n");
