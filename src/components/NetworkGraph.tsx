import { useEffect, useId, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { COLD, H, HOT, LIGHT_RANGE, SPLIT_ENERGY, START_ENERGY, SUN_SPEED, W, familyOf, feedRadius, lightAt, pushVector, senseRadius, sunAt, temperature, tired } from "../core/evolve";
import type { Energy, Point, World } from "../core/evolve";
import { SENSES, members } from "../core/model";
import type { NetworkModel } from "../core/model";
import type { TierScore } from "../core/recursion";
import { HALF_COLORS, familyColor } from "../tiers";

type Body = Point & { vx: number; vy: number };
export type Bodies = Map<string, Body>;
type Grab = { neuron: number; id: string };
export const GROUP_COLORS = ["#0a9d62", "#9d4edd", "#f77f00"];
export const groupName = (model: NetworkModel, mask: number) =>
  `{${members(mask, model.nodes.length)
    .map((i) => model.nodes[i].label)
    .join(", ")}}`;

const FADE = 900;
const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
const radius = (n: number) => (n > 12 ? 26 : 34);

/** Place new neurons beside their parent family member, connected neurons, or the existing cluster near food/sun. */
function place(model: NetworkModel, bodies: Bodies, world?: World) {
  const n = Math.max(1, model.nodes.length);
  const existing = [...bodies.values()];
  const bestFood =
    world && world.food.length > 0
      ? [...world.food].sort((a, b) => b.amount * (lightAt(world, b) + 0.2) - a.amount * (lightAt(world, a) + 0.2))[0]
      : undefined;
  const clusterCenter = existing.length
    ? centroid(existing)
    : bestFood
      ? { x: bestFood.x, y: bestFood.y }
      : { x: W / 2, y: LIGHT_RANGE * 0.45 };
  model.nodes.forEach((node, i) => {
    if (bodies.has(node.id)) return;
    const kin = model.nodes.find((o) => o.id !== node.id && familyOf(o.label) === familyOf(node.label) && bodies.has(o.id));
    const parent = kin ? bodies.get(kin.id) : undefined;
    if (parent) {
      const angle = Math.random() * 2 * Math.PI;
      bodies.set(node.id, { x: parent.x + Math.cos(angle) * 18, y: parent.y + Math.sin(angle) * 18, vx: 0, vy: 0 });
      return;
    }
    const near = node.inputs.flatMap((j) => bodies.get(model.nodes[j]?.id) ?? []);
    const base = near.length
      ? centroid(near)
      : {
          x: clusterCenter.x + (model.nodes.length > 1 ? Math.cos((i * 2 * Math.PI) / n) * 80 : 0),
          y: clusterCenter.y + (model.nodes.length > 1 ? Math.sin((i * 2 * Math.PI) / n) * 70 : 0),
        };
    bodies.set(node.id, { x: base.x + Math.random() * 30 - 15, y: base.y + Math.random() * 30 - 15, vx: 0, vy: 0 });
  });
}

/** One physics frame: neurons repel, links pull like springs, and active push neurons direct the whole system. */
function settle(model: NetworkModel, influences: number[][], bodies: Bodies, state: number, world: World, pinned?: string) {
  place(model, bodies, world);
  const list = model.nodes.map((node) => bodies.get(node.id)!);
  const n = list.length,
    r = radius(n),
    rest = r * 4.6;
  const center = centroid(list);
  const push = pushVector(model, state, world, (id) => bodies.get(id) ?? center);
  list.forEach((b, i) => {
    b.vx += (center.x - b.x) * 0.003 + push.x;
    b.vy += (center.y - b.y) * 0.003 + push.y;
    if (model.nodes[i].push && (state >>> i) & 1) {
      b.vx += push.x * 0.4;
      b.vy += push.y * 0.4;
    }
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
      const force = 5200 / (d * d) - pull * 0.015 * (d - rest);
      a.vx -= (dx / d) * force;
      a.vy -= (dy / d) * force;
      b.vx += (dx / d) * force;
      b.vy += (dy / d) * force;
    }
  model.nodes.forEach((node, i) => {
    const b = list[i];
    if (node.id === pinned) return void ((b.vx = 0), (b.vy = 0));
    b.vx *= 0.82;
    b.vy *= 0.82;
    if (Math.hypot(b.vx, b.vy) < 0.05) return;
    b.x = Math.max(r + 16, Math.min(W - r - 16, b.x + b.vx));
    b.y = Math.max(r + 30, Math.min(H - r - 16, b.y + b.vy));
  });
}

function hull(points: Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const half = (list: Point[]) => {
    const out: Point[] = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    return out;
  };
  return [...half(sorted).slice(0, -1), ...half([...sorted].reverse()).slice(0, -1)];
}

export function outline(points: Point[], padding: number): string {
  if (!points.length) return "";
  const vertices = points.length === 1 ? points : hull(points);
  if (vertices.length <= 1) {
    const [{ x, y }] = points;
    return `M ${x - padding},${y} A ${padding},${padding} 0 1 0 ${x + padding},${y} A ${padding},${padding} 0 1 0 ${x - padding},${y} Z`;
  }
  if (vertices.length === 2) {
    const [a, b] = vertices;
    const d = Math.max(0.001, Math.hypot(b.x - a.x, b.y - a.y));
    const nx = (-(b.y - a.y) / d) * padding,
      ny = ((b.x - a.x) / d) * padding;
    return `M ${a.x + nx},${a.y + ny} L ${b.x + nx},${b.y + ny} A ${padding},${padding} 0 0 0 ${b.x - nx},${b.y - ny} L ${a.x - nx},${a.y - ny} A ${padding},${padding} 0 0 0 ${a.x + nx},${a.y + ny} Z`;
  }
  const center = centroid(vertices);
  return (
    vertices
      .map((p, i) => {
        const d = Math.max(1, Math.hypot(p.x - center.x, p.y - center.y));
        return `${i ? "L" : "M"} ${p.x + ((p.x - center.x) / d) * padding},${p.y + ((p.y - center.y) / d) * padding}`;
      })
      .join(" ") + " Z"
  );
}

const centroid = (points: Point[]): Point =>
  points.length
    ? {
        x: points.reduce((s, p) => s + p.x, 0) / points.length,
        y: points.reduce((s, p) => s + p.y, 0) / points.length,
      }
    : { x: W / 2, y: LIGHT_RANGE * 0.45 };

/** De Casteljau: point at t on a Bézier curve through its control points. */
const bezier = (pts: Point[], t: number): Point =>
  pts.length === 1
    ? pts[0]
    : bezier(
        pts.slice(1).map((b, k) => ({ x: pts[k].x + (b.x - pts[k].x) * t, y: pts[k].y + (b.y - pts[k].y) * t })),
        t,
      );

const curve = ([a, ...rest]: Point[]) =>
  `M ${a.x},${a.y} ${rest.length === 2 ? "Q" : "C"} ${rest.map((p) => `${p.x},${p.y}`).join(" ")}`;

/** A curved arrow from a to b that bends to its left, trimmed by `trim` at both ends. */
function arc(a: Point, b: Point, bend: number, trim: number): Point[] {
  const length = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
  const ux = (b.x - a.x) / length,
    uy = (b.y - a.y) / length;
  return [
    { x: a.x + ux * trim, y: a.y + uy * trim },
    { x: (a.x + b.x) / 2 - uy * bend, y: (a.y + b.y) / 2 + ux * bend },
    { x: b.x - ux * trim, y: b.y - uy * trim },
  ];
}

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

export default function NetworkGraph({
  model,
  influences,
  bodies,
  history,
  energy,
  world,
  tick,
  period,
  running,
  outlines,
  focus,
  selectedNeuron,
  onNeuron,
}: {
  model: NetworkModel;
  influences: number[][];
  bodies: Bodies;
  history: number[];
  energy: Energy;
  world: World;
  tick: number;
  period: number;
  running: boolean;
  outlines: { mask: number; color: string; bold: boolean }[];
  focus?: TierScore;
  selectedNeuron: number | null;
  onNeuron: (index: number) => void;
}) {
  const state = history[history.length - 1];
  const ghosts = useRef<(Point & { at: number; id: string })[]>([]);
  const births = useRef<(Point & { at: number; id: string })[]>([]);
  const reaches = useRef<{ fromId: string; toId: string; at: number; key: string }[]>([]);
  const prevLinks = useRef<Set<string>>(new Set());
  const ids = useRef<string[]>([]);
  const latest = useRef({ model, influences, state, world });
  latest.current = { model, influences, state, world };
  const drag = useRef<{ grab: Grab; moved: boolean; start: Point } | null>(null);
  const tickStart = useRef(0);
  const [now, setNow] = useState(0);
  const svg = useRef<SVGSVGElement>(null);
  const marker = useId().replaceAll(":", "");

  useEffect(() => {
    tickStart.current = performance.now();
  }, [tick]);

  useEffect(() => {
    place(model, bodies, latest.current.world);
    const present = new Set(model.nodes.map((node) => node.id));
    const prev = new Set(ids.current);
    const nowTime = performance.now();
    if (prev.size > 0) {
      for (const id of present)
        if (!prev.has(id)) {
          const body = bodies.get(id);
          if (body) births.current.push({ x: body.x, y: body.y, at: nowTime, id });
        }
    }
    for (const id of ids.current)
      if (!present.has(id)) {
        const body = bodies.get(id);
        if (body) ghosts.current.push({ x: body.x, y: body.y, at: nowTime, id });
        bodies.delete(id);
      }
    ids.current = [...present];

    const currentLinks = new Set<string>();
    model.nodes.forEach((node) => {
      node.inputs.forEach((srcIdx) => {
        const src = model.nodes[srcIdx];
        if (!src) return;
        const key = `${src.id}->${node.id}`;
        currentLinks.add(key);
        if (prevLinks.current.size > 0 && !prevLinks.current.has(key)) {
          reaches.current.push({ fromId: src.id, toId: node.id, at: nowTime, key: `${key}-${nowTime}` });
        }
      });
    });
    prevLinks.current = currentLinks;
  }, [model, bodies]);

  useEffect(() => {
    let frame = requestAnimationFrame(function animate(time) {
      const grab = drag.current?.grab;
      const cur = latest.current;
      settle(cur.model, cur.influences, bodies, cur.state, cur.world, grab?.id);
      ghosts.current = ghosts.current.filter((g) => time - g.at < FADE);
      births.current = births.current.filter((b) => time - b.at < FADE);
      reaches.current = reaches.current.filter((rc) => time - rc.at < FADE);
      setNow(time);
      frame = requestAnimationFrame(animate);
    });
    return () => cancelAnimationFrame(frame);
  }, [bodies]);

  place(model, bodies, world);
  const at = model.nodes.map((node) => bodies.get(node.id)!);
  const n = model.nodes.length;
  const r = radius(n);
  const on = (i: number) => (state >>> i) & 1;
  const phase = running && !reducedMotion() ? Math.min(1, (now - tickStart.current) / period) : 0;
  const travel = ease(phase);
  const pointAt = (event: PointerEvent<SVGElement>): Point => {
    const point = svg.current!.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const p = point.matrixTransform(svg.current!.getScreenCTM()!.inverse());
    return { x: Math.max(r, Math.min(W - r, p.x)), y: Math.max(r, Math.min(H - r, p.y)) };
  };
  const grab = (target: Grab) => (event: PointerEvent<SVGElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { grab: target, moved: false, start: pointAt(event) };
  };

  const hasLink = (from: number, to: number) => model.nodes[to]?.inputs.includes(from) ?? false;
  const edges = model.nodes.flatMap((node, j) =>
    node.inputs.flatMap((i) => {
      if (i < 0 || i >= n || i === j) return [];
      const weight = Math.max(0.35, influences[i]?.[j] ?? 0.5);
      const mutual = hasLink(j, i);
      return [{ i, j, weight, pts: arc(at[i], at[j], mutual ? 24 : 0, r + 5) }];
    }),
  );

  const half = model.nodes.map(() => -1);
  if (focus?.tier === "consciousness")
    [focus.model, focus.record].forEach((mask, k) => members(mask, n).forEach((i) => (half[i] = k)));
  const cross = (i: number, j: number) => half[i] >= 0 && half[j] >= 0 && half[i] !== half[j];
  const dim = (i: number, j: number) => !!focus && !(((focus.mask >>> i) & 1) && ((focus.mask >>> j) & 1));
  const rim = (i: number) => (half[i] >= 0 ? { stroke: HALF_COLORS[half[i]] } : undefined);

  return (
    <svg
      ref={svg}
      viewBox={`0 0 ${W} ${H}`}
      className="network-svg"
      aria-label="Neuron network. Click a neuron to edit its rule. Drag neurons."
      onPointerMove={(event) => {
        const d = drag.current;
        if (!d) return;
        const p = pointAt(event);
        if (Math.hypot(p.x - d.start.x, p.y - d.start.y) > 14) d.moved = true;
        if (d.moved) Object.assign(bodies.get(d.grab.id) ?? {}, p);
      }}
      onPointerUp={() => {
        const d = drag.current;
        if (d && !d.moved) onNeuron(d.grab.neuron);
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
    >
      <defs>
        <marker
          id={marker}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="12"
          markerHeight="12"
          markerUnits="userSpaceOnUse"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
        </marker>
        <radialGradient id={`${marker}-sun`}>
          <stop offset="0" stopColor="var(--sun)" stopOpacity="0.45" />
          <stop offset="1" stopColor="var(--sun)" stopOpacity="0" />
        </radialGradient>
      </defs>
      {world.lit && (() => {
        const sunPos = sunAt({ ...world, sun: world.sun + phase * SUN_SPEED });
        return (
          <g className="sun" transform={`translate(${sunPos.x},${sunPos.y})`}>
            <circle r={LIGHT_RANGE} fill={`url(#${marker}-sun)`} />
            <circle className="zone cold" r={LIGHT_RANGE * (1 - COLD)} />
            <circle className="zone hot" r={LIGHT_RANGE * (1 - HOT)} />
          </g>
        );
      })()}
      {world.food.map((f, k) => (
        <g key={k} className="food" transform={`translate(${f.x},${f.y})`}>
          <circle className="zone smell" r={senseRadius(f)} />
          <circle className="zone feed" r={feedRadius(f)} />
          <polygon className="food-core" points="0,-18 18,0 0,18 -18,0" transform={`scale(${Math.max(0.35, f.amount)})`} />
        </g>
      ))}
      {outlines.map(({ mask, color, bold }, k) => {
        const group = members(mask, n);
        if (!group.length) return null;
        const lit = group.filter(on).length / group.length;
        return (
          <path
            key={mask}
            className="group-outline"
            d={outline(
              group.map((j) => at[j]),
              r + 12 + k * 6,
            )}
            fill={color}
            fillOpacity={0.03 + lit * 0.12}
            stroke={color}
            strokeWidth={bold ? 4 : 2.5}
            strokeDasharray="9 6"
            strokeLinejoin="round"
          >
            <title>{groupName(model, mask)}</title>
          </path>
        );
      })}
      {edges.map(({ i, j, weight, pts }) => (
        <path
          key={`${i}-${j}`}
          className={`edge ${dim(i, j) ? "dim" : ""} ${on(i) ? "active" : ""}`}
          d={curve(pts)}
          fill="none"
          stroke={cross(i, j) ? HALF_COLORS[half[i]] : on(i) ? "var(--ink)" : "var(--wire)"}
          strokeOpacity={cross(i, j) && !on(i) ? 0.65 : 1}
          strokeWidth={(cross(i, j) ? 4.5 : 2.5) + weight * 2.5}
          markerEnd={`url(#${marker})`}
        >
          <title>
            {model.nodes[j].label} connects to {model.nodes[i].label}
          </title>
        </path>
      ))}
      {reaches.current.map((rc) => {
        const a = bodies.get(rc.fromId);
        const b = bodies.get(rc.toId);
        if (!a || !b) return null;
        const t = Math.min(1, (now - rc.at) / FADE);
        const tip = { x: a.x + (b.x - a.x) * ease(t), y: a.y + (b.y - a.y) * ease(t) };
        return (
          <line
            key={rc.key}
            className="reach-out"
            x1={b.x}
            y1={b.y}
            x2={tip.x}
            y2={tip.y}
            opacity={1 - t * 0.6}
          />
        );
      })}
      {phase > 0 &&
        edges
          .filter(({ i }) => on(i))
          .map(({ i, j, pts }) => {
            const p = bezier(pts, travel);
            return (
              <circle
                key={`${i}-${j}`}
                className="pulse"
                cx={p.x}
                cy={p.y}
                r={cross(i, j) ? 7.5 : 5.5}
                style={cross(i, j) ? { fill: HALF_COLORS[half[i]] } : undefined}
              />
            );
          })}
      {births.current.map((b) => {
        const t = (now - b.at) / FADE;
        return <circle key={b.id} className="birth" cx={b.x} cy={b.y} r={r * (0.8 + t * 2)} opacity={1 - t} />;
      })}
      {ghosts.current.map((g) => {
        const t = (now - g.at) / FADE;
        return <circle key={g.id} className="ghost" cx={g.x} cy={g.y} r={r * (1 + t * 1.5)} opacity={1 - t} />;
      })}
      {model.nodes.map((node, i) => {
        const heat = temperature(world, at[i], history, i);
        const e = energy[node.id] ?? START_ENERGY;
        const feel = heat < COLD ? "cold" : heat > HOT ? "hot" : "ok";
        return (
          <g
            key={node.id}
            className={`graph-node ${on(i) ? "on" : ""} ${tired(history, i) ? "tired" : ""} ${selectedNeuron === i ? "selected" : ""}`}
            role="button"
            tabIndex={0}
            aria-label={`Edit neuron ${node.label}`}
            aria-pressed={selectedNeuron === i}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                event.stopPropagation();
                onNeuron(i);
              }
            }}
            onPointerDown={grab({ neuron: i, id: node.id })}
            transform={`translate(${at[i].x},${at[i].y})`}
          >
            <title>
              {node.label}
              {node.sense ? ` · senses ${node.sense}` : ""}
              {node.push ? ` · moves toward ${node.push}` : ""} · energy {e.toFixed(2)} · {feel}
            </title>
            <g className="spawn">
              <circle className="halo" r={r + 14} />
              {node.push && <circle className={`mover-ring mover-${node.push}`} r={r + 12} />}
              <circle
                className={`energy ${feel}`}
                r={r + 6}
                pathLength={1}
                strokeDasharray={`${Math.min(1, e / SPLIT_ENERGY)} 1`}
                transform="rotate(-90)"
              />
              {node.sense ? (
                <rect className="neuron-body" x={-r} y={-r} width={2 * r} height={2 * r} rx={r * 0.35} style={rim(i)} />
              ) : (
                <circle className="neuron-body" r={r} style={rim(i)} />
              )}
              <circle className="family" cx={r * 0.74} cy={-r * 0.74} r={r > 28 ? 8 : 6} fill={familyColor(familyOf(node.label))} />
              {node.sense && (
                <text className="node-tag" x={-r * 0.68} y={-r * 0.52} textAnchor="middle">
                  {node.label}
                </text>
              )}
              <text className="sense" textAnchor="middle" dy="0.36em">
                {node.sense ? SENSES[node.sense] : node.label}
              </text>
              {node.push && (
                <g className="mover-badge" transform={`translate(0,${r + 2})`}>
                  <rect x={-26} y={-13} width={52} height={24} rx={12} />
                  <text textAnchor="middle" dy="0.32em">
                    ◎{SENSES[node.push]}
                  </text>
                </g>
              )}
            </g>
          </g>
        );
      })}
    </svg>
  );
}
