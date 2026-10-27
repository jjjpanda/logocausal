import type { NetworkModel } from "./core/model";
import type { TierScore } from "./core/recursion";
import type { CircuitDescription } from "./core/machine";

export type WorkerRequest = NetworkModel;
export type Analysis = { tiers: TierScore[]; circuits: CircuitDescription[] };
export type WorkerResponse = Analysis | { error: string };
