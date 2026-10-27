import { analyze } from "./core/recursion";
import { describeCircuits } from "./core/machine";
import type { WorkerRequest, WorkerResponse } from "./worker-protocol";

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  let reply: WorkerResponse;
  try {
    reply = { tiers: analyze(event.data), circuits: describeCircuits(event.data) };
  } catch (error) {
    reply = { error: error instanceof Error ? error.message : "Analysis failed." };
  }
  self.postMessage(reply);
};
