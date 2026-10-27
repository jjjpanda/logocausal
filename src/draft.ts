import { validateModel } from "./core/model";
import type { NetworkModel } from "./core/model";

export const DRAFT_KEY = "logocausal:draft:v3";

export function parseDraft(json: string): NetworkModel {
  const { model } = JSON.parse(json);
  validateModel(model);
  if (!model.nodes.length) throw new Error("Draft must contain at least one neuron.");
  return model;
}

export const serializeDraft = (model: NetworkModel): string => JSON.stringify({ model });
