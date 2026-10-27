import type { NetworkModel } from "./core/model";
import type { TierScore } from "./core/recursion";

export type WorkerRequest = NetworkModel;
export type WorkerResponse = { tiers: TierScore[] } | { error: string };
