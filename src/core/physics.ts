import { H, LIGHT_RANGE, W, familyOf, lightAt, processRate, motorVectors, temperature, worldBounds } from "./evolve";
import type { Point, World } from "./evolve";
import type { NetworkModel } from "./model";

export type Body = Point & { vx: number; vy: number };
export type Bodies = Map<string, Body>;

export const centroid = (points: Point[]): Point =>
  points.length
    ? {
        x: points.reduce((s, p) => s + p.x, 0) / points.length,
        y: points.reduce((s, p) => s + p.y, 0) / points.length,
      }
    : { x: W / 2, y: LIGHT_RANGE * 0.45 };

export const radius = (n: number, world?: World) => Math.max(n > 12 ? 26 : 34, world?.minimumNeuronRadius ?? 0);

/** Stable spring lengths per neuron pair; independent of node order and signal direction. */
export function linkRestLength(a: string, b: string, r: number): number {
  let hash = 2166136261;
  for (const char of JSON.stringify([a, b].sort())) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return r * (3.2 + (hash >>> 0) / 0xffffffff * 5);
}

/** Keep bodies and their captions apart, including when a paused canvas is resized. */
export function separate(model: NetworkModel, bodies: Bodies, world: World, pinned?: string, passes = 2) {
  const { width, height } = worldBounds(world);
  const r = radius(model.nodes.length, world);
  const list = model.nodes.map(node => bodies.get(node.id));
  const marginX = Math.min(r * 1.6, width / 2), marginY = Math.min(r * 1.9, height / 2);
  for (let pass = 0; pass < passes; pass++) {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (!a || !b) continue;
      let dx = (b.x - a.x) / (r * 3.1), dy = (b.y - a.y) / (r * 3.8);
      let distance = Math.hypot(dx, dy);
      if (distance >= 1) continue;
      if (distance < 1e-6) { dx = Math.cos(j * 2.4); dy = Math.sin(j * 2.4); distance = 1e-6; }
      const shiftX = dx / Math.hypot(dx, dy) * (1 - distance) * r * 3.1;
      const shiftY = dy / Math.hypot(dx, dy) * (1 - distance) * r * 3.8;
      const pinnedA = model.nodes[i].id === pinned, pinnedB = model.nodes[j].id === pinned;
      if (!pinnedA) { a.x -= shiftX * (pinnedB ? 1 : 0.5); a.y -= shiftY * (pinnedB ? 1 : 0.5); }
      if (!pinnedB) { b.x += shiftX * (pinnedA ? 1 : 0.5); b.y += shiftY * (pinnedA ? 1 : 0.5); }
    }
    for (const b of list) if (b) {
      b.x = Math.max(marginX, Math.min(width - marginX, b.x));
      b.y = Math.max(marginY, Math.min(height - marginY, b.y));
    }
  }
}

/** Place new neurons beside their parent family member, connected neurons, or the existing cluster near food/sun. */
export function place(model: NetworkModel, bodies: Bodies, world?: World) {
  const { width, height } = world ? worldBounds(world) : { width: W, height: H };
  const r = radius(model.nodes.length, world);
  const marginX = Math.min(r * 1.6, width / 2), marginY = Math.min(r * 1.9, height / 2);
  const clamp = (p: Point): Point => ({
    x: Math.max(marginX, Math.min(width - marginX, p.x)),
    y: Math.max(marginY, Math.min(height - marginY, p.y)),
  });
  const n = Math.max(1, model.nodes.length);
  const separation = radius(n, world) * 2 + 24;
  const existing = [...bodies.values()];
  const bestFood =
    world && world.food.length > 0
      ? [...world.food].sort((a, b) => b.amount * (lightAt(world, b) + 0.2) - a.amount * (lightAt(world, a) + 0.2))[0]
      : undefined;
  const clusterCenter = existing.length
    ? centroid(existing)
    : bestFood
      ? { x: bestFood.x, y: bestFood.y }
      : { x: width / 2, y: Math.min(height / 2, LIGHT_RANGE * 0.45) };
  model.nodes.forEach((node, i) => {
    if (bodies.has(node.id)) return;
    const kin = model.nodes.find((o) => o.id !== node.id && familyOf(o.label) === familyOf(node.label) && bodies.has(o.id));
    const parent = kin ? bodies.get(kin.id) : undefined;
    if (parent) {
      const angle = Math.random() * 2 * Math.PI;
      bodies.set(node.id, { ...clamp({ x: parent.x + Math.cos(angle) * 18, y: parent.y + Math.sin(angle) * 18 }), vx: 0, vy: 0 });
      return;
    }
    const near = node.inputs.flatMap((j) => bodies.get(model.nodes[j]?.id) ?? []);
    const base = near.length
      ? centroid(near)
      : {
          x: clusterCenter.x + (model.nodes.length > 1 ? Math.cos((i * 2 * Math.PI) / n) * 80 : 0),
          y: clusterCenter.y + (model.nodes.length > 1 ? Math.sin((i * 2 * Math.PI) / n) * 70 : 0),
        };
    let spot = clamp({ x: base.x + Math.random() * 30 - 15, y: base.y + Math.random() * 30 - 15 });
    // New populations must be selectable even when paused before their first tick.
    for (let attempt = 1; attempt <= 64 && [...bodies.values()].some(b => Math.hypot(b.x - spot.x, b.y - spot.y) < separation); attempt++) {
      const angle = attempt * 2.39996;
      spot = clamp({
        x: base.x + Math.cos(angle) * separation * 0.55 * Math.sqrt(attempt),
        y: base.y + Math.sin(angle) * separation * 0.55 * Math.sqrt(attempt),
      });
    }
    bodies.set(node.id, { ...spot, vx: 0, vy: 0 });
  });
}

/** One physics frame: neurons repel, links pull like springs, and motors move their own bodies. */
export function settle(model: NetworkModel, influences: number[][], bodies: Bodies, state: number, world: World, pinned?: string) {
  const { width, height } = worldBounds(world);
  place(model, bodies, world);
  const list = model.nodes.map((node) => bodies.get(node.id)!);
  const n = list.length, r = radius(n, world);
  const rates = model.nodes.map((node, i) => processRate(temperature(world, list[i], [state], i, node.id)));
  const motors = motorVectors(model, state, world, (id) => bodies.get(id)!);
  list.forEach((b, i) => {
    b.vx += motors[i].x;
    b.vy += motors[i].y;
  });
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const a = list[i],
        b = list[j];
      const dx = b.x - a.x,
        dy = b.y - a.y,
        d = Math.max(8, Math.hypot(dx, dy));
      const linked = Number(model.nodes[i].inputs.includes(j)) + Number(model.nodes[j].inputs.includes(i));
      const pull = Math.max(linked * 0.5, influences[i][j] + influences[j][i]);
      const rest = linkRestLength(model.nodes[i].id, model.nodes[j].id, r);
      const force = 5200 / (d * d) - pull * 0.015 * (d - rest);
      a.vx -= (dx / d) * force * rates[i];
      a.vy -= (dy / d) * force * rates[i];
      b.vx += (dx / d) * force * rates[j];
      b.vy += (dy / d) * force * rates[j];
    }
  model.nodes.forEach((node, i) => {
    const b = list[i];
    if (node.id === pinned) return void ((b.vx = 0), (b.vy = 0));
    b.vx *= 0.82 ** rates[i];
    b.vy *= 0.82 ** rates[i];
    if (Math.hypot(b.vx, b.vy) < 0.05) return;
    const marginX = Math.min(r * 1.5, width / 2), marginY = Math.min(r * 1.8, height / 2);
    b.x = Math.max(marginX, Math.min(width - marginX, b.x + b.vx * rates[i]));
    b.y = Math.max(marginY, Math.min(height - marginY, b.y + b.vy * rates[i]));
  });
  separate(model, bodies, world, pinned);
}

