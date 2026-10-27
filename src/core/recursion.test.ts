import { describe, expect, it } from "vitest";
import { fixtureModel, fixtures } from "./fixtures";
import { MAX_GROUP, analyze } from "./recursion";
import { randomModel } from "./model";

const tier = (id: string, mask: number) => analyze(fixtureModel(id)).find((s) => s.mask === mask)!;

describe("recursive tiers", () => {
  it("scores self-copying nodes as aware but not conscious", () => {
    const single = tier("independent", 1);
    expect(single.awareness).toBeCloseTo(1, 9);
    expect(single.loop).toBe(0);
    expect(single.tier).toBe("awareness");
  });

  it("scores a mutual loop as conscious while its parts only perceive", () => {
    const swap = fixtureModel("oneway");
    swap.nodes[0].inputs = [1];
    const tiers = analyze(swap);
    const pair = tiers.find((s) => s.mask === 3)!;
    expect(pair.loop).toBeCloseTo(1, 9);
    expect(pair.tier).toBe("consciousness");
    expect(tiers.find((s) => s.mask === 1)!.tier).toBe("perception");
  });

  it("scores the overlap chain's two loops equally and skips their superset and leaves A,C unlinked", () => {
    expect(tier("overlap", 3).loop).toBeCloseTo(0.311278124, 8);
    expect(tier("overlap", 6).loop).toBeCloseTo(0.311278124, 8);
    expect(analyze(fixtureModel("overlap")).some((s) => s.mask === 7)).toBe(false);
    expect(analyze(fixtureModel("overlap")).some((s) => s.mask === 5)).toBe(false);
  });

  it("gives one-way influence awareness without a loop", () => {
    const pair = tier("oneway", 3);
    expect(pair.tier).toBe("awareness");
    expect(pair.loop).toBe(0);
  });

  it("treats a sensor as an outside random bit", () => {
    const tiers = analyze(fixtureModel("forager"));
    expect(tiers.find((s) => s.mask === 0b1)!.tier).toBe("perception");
    expect(tiers.find((s) => s.mask === 0b1100)!.tier).toBe("consciousness");
    expect(tiers.find((s) => s.mask === 0b101)!.awareness).toBeGreaterThan(0);
  });

  it("never joins unlinked neurons", () => {
    const masks = analyze(fixtureModel("clusters")).map((s) => s.mask);
    expect(masks.sort()).toEqual([1, 2, 3, 4, 8, 12].sort());
  });

  it("never scores a loop above its group's awareness", () => {
    for (const model of [...fixtures.map((f) => f.model), randomModel(12, 7)])
      for (const s of analyze(model)) expect(s.loop).toBeLessThanOrEqual(s.awareness + 1e-9);
  });

  it("analyses the largest network with bounded group size", () => {
    const tiers = analyze(randomModel(24, 3));
    expect(tiers.length).toBeGreaterThan(24);
    expect(Math.max(...tiers.map((s) => s.size))).toBeLessThanOrEqual(MAX_GROUP);
  });
});
