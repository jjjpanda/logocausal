import { FOOD_START_AMOUNT, HISTORY, W, live, processTiming, step } from "./evolve";
import type { Energy, World } from "./evolve";
import { influences } from "./info";
import { remapState } from "./model";
import type { NetworkModel } from "./model";
import { place, settle } from "./physics";
import type { Bodies } from "./physics";
import type { TierScore } from "./recursion";

export interface SimulationState { model: NetworkModel; history: number[]; energy: Energy; world: World }

export const initialWorld = (): World => ({ sun: W / 2, food: [
  { x: W / 2 - 550, y: 240, amount: FOOD_START_AMOUNT },
  { x: W / 2, y: 600, amount: FOOD_START_AMOUNT },
  { x: W / 2 + 550, y: 240, amount: FOOD_START_AMOUNT },
] });

/** The same authoritative tick in the browser and seeded diagnostics.
 * Physics mutates body positions; model, world and signal history stay immutable.
 */
export function tickSimulation(state: SimulationState, bodies: Bodies, tiers: TierScore[] | null,
  rng: () => number = Math.random, noise = 0.002, matrix = influences(state.model)) {
  const { model, history, energy, world } = state;
  place(model, bodies, world, rng);
  const locate = (id: string) => bodies.get(id)!;
  for (let substep = 0; substep < 20; substep++) settle(model, matrix, bodies, history.at(-1)!, world);
  const timing = processTiming(model, history, world, locate);
  const signals = [...history, step(model, history, world, locate, noise, rng, timing)].slice(-HISTORY);
  const life = live(model, tiers, signals, energy, world, locate, rng, timing);
  const nextHistory = life.model === model ? signals : signals.map(signal => remapState(signal, model, life.model));
  return { ...life, history: nextHistory, signals, timing };
}
