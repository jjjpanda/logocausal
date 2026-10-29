import { describe, expect, it } from "vitest";
import { fixtureModel } from "./fixtures";
import { H, W } from "./evolve";
import { settle } from "./physics";
import type { Bodies } from "./physics";

describe("physics", () => {
  it("does not push an unlinked bystander when a motor fires", () => {
    const model = { ...fixtureModel("independent"), nodes: [
      { id: "motor", label: "A", inputs: [], table: [0], push: "food" as const },
      { id: "bystander", label: "B", inputs: [], table: [0] },
    ] };
    const initial: Bodies = new Map([
      ["motor", { x: 500, y: 400, vx: 0, vy: 0 }],
      ["bystander", { x: 1100, y: 400, vx: 0, vy: 0 }],
    ]);
    const off = structuredClone(initial), on = structuredClone(initial);
    const world = { sun: W / 2, food: [{ x: 600, y: 400, amount: 4 }] };
    settle(model, [[0, 0], [0, 0]], off, 0, world);
    settle(model, [[0, 0], [0, 0]], on, 1, world);
    expect(on.get("bystander")).toEqual(off.get("bystander"));
    expect(on.get("motor")!.x).toBeGreaterThan(off.get("motor")!.x);
  });
  it("moves cold neurons more slowly under the same forces", () => {
    const model = fixtureModel("oneway");
    const initial: Bodies = new Map(model.nodes.map((n, i) => [n.id,
      { x: W / 2 + (i ? 150 : -150), y: 200, vx: 0, vy: 0 }]));
    const displacement = (sun: number) => {
      const bodies = structuredClone(initial);
      for (let i = 0; i < 10; i++) settle(model, [[0, 0], [0, 0]], bodies, 0, { sun, food: [] });
      return model.nodes.reduce((sum, node) => sum + Math.hypot(bodies.get(node.id)!.x - initial.get(node.id)!.x,
        bodies.get(node.id)!.y - initial.get(node.id)!.y), 0);
    };
    expect(displacement(W + H)).toBeLessThan(displacement(W / 2));
  });
  it("settles different links at varied lengths", () => {
    const lengths = Array.from({ length: 16 }, (_, k) => {
      const model = fixtureModel("oneway");
      model.nodes[0].id = `source-${k}`;
      model.nodes[1].id = `reader-${k}`;
      const bodies: Bodies = new Map(model.nodes.map((n, i) => [n.id,
        { x: W / 2 + (i ? 150 : -150), y: H / 2, vx: 0, vy: 0 }]));
      for (let i = 0; i < 300; i++) settle(model, [[0, 0], [0, 0]], bodies, 0, { sun: 0, food: [] });
      const [a, b] = model.nodes.map(n => bodies.get(n.id)!);
      return Math.hypot(a.x - b.x, a.y - b.y);
    });
    expect(Math.max(...lengths) - Math.min(...lengths)).toBeGreaterThan(40);
    expect(lengths.every(length => length > 68)).toBe(true);
  });

  it("contains neurons within the current habitat rather than the default world", () => {
    const model = fixtureModel("oneway");
    const bounds = { width: 700, height: 500 };
    const bodies: Bodies = new Map(model.nodes.map((n, i) => [n.id,
      { x: 900 + i * 200, y: 900, vx: 10, vy: 10 }]));
    settle(model, [[0, 0], [0, 0]], bodies, 0, { sun: 0, food: [], bounds });
    for (const b of bodies.values()) {
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x).toBeLessThanOrEqual(bounds.width);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeLessThanOrEqual(bounds.height);
    }
  });
});
