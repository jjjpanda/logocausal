import { describe, expect, it } from "vitest";
import { fixtureModel, fixtures } from "./fixtures";
import { MAX_GROUP, analyze, groupBits, highestGroup, rankGroups, remapScores } from "./recursion";
import { randomModel, removeNode } from "./model";

const tier = (id: string, mask: number) => analyze(fixtureModel(id)).find((s) => s.mask === mask)!;

describe("recursive tiers", () => {
  it("reindexes delayed worker results by their original IDs and drops incomplete groups", () => {
    const model = fixtureModel("clusters");
    const tiers = analyze(model);
    const reduced = removeNode(model, 0);
    const mapped = remapScores(tiers, model, reduced);
    const loop = mapped.find(score => score.tier === "consciousness")!;
    expect(loop.mask).toBe(6);
    expect(loop.size).toBe(2);
    expect(mapped.every(score => score.mask !== 1 || score.tier !== "consciousness")).toBe(true);
    const again = remapScores(tiers, model, removeNode(reduced, 0));
    expect(again.find(score => score.tier === "consciousness")!.mask).toBe(3);
  });
  it("ranks feedback loops above self-prediction and breaks ties consistently", () => {
    const loop = tier("overlap", 3);
    const awareness = tier("oneway", 3);
    expect(groupBits(awareness)).toBeGreaterThan(groupBits(loop));
    expect(highestGroup([awareness, loop])).toBe(loop);
    expect(rankGroups([awareness])).toEqual([awareness]);
    const tied = { ...loop, mask: 6 };
    expect(highestGroup([tied, loop])).toBe(loop);
    expect(highestGroup(analyze(fixtureModel("independent")))).toBeUndefined();
  });
  it("scores unlinked nodes as perception without self-loops", () => {
    const single = tier("independent", 1);
    expect(single.awareness).toBe(0);
    expect(single.loop).toBe(0);
    expect(single.tier).toBe("perception");
  });

  it("scores a mutual loop as conscious while its parts only perceive", () => {
    const swap = fixtureModel("oneway");
    swap.nodes[0] = { ...swap.nodes[0], sense: undefined, inputs: [1], table: [0, 1] };
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
