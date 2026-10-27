import { validateModel } from "./core/model";
import type { NetworkModel } from "./core/model";

export const DRAFT_KEY = "logocausal:draft:v3";

export function parseDraft(json: string): NetworkModel {
  const { model } = JSON.parse(json);
  validateModel(model);
  return model;
}

export const serializeDraft = (model: NetworkModel): string => JSON.stringify({ model });
