import { expect, it } from "vitest";
import { fixtureModel } from "./core/fixtures";
import { parseDraft, serializeDraft } from "./draft";

it("round-trips the model and rejects malformed drafts", () => {
  const model = fixtureModel("overlap");
  expect(parseDraft(serializeDraft(model))).toEqual(model);
  for (const json of ["{", "null", "{}", JSON.stringify({ model: { ...model, version: 2 } })])
    expect(() => parseDraft(json)).toThrow();
});
