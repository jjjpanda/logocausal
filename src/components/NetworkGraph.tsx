import { useEffect, useId, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { COLD, H, HOT, LIGHT_RANGE, SMELL_RANGE, SPLIT_ENERGY, START_ENERGY, W, familyOf, sunAt, temperature, tired } from "../core/evolve";
import type { Energy, Point, World } from "../core/evolve";
import { SENSES, members } from "../core/model";
import type { NetworkModel } from "../core/model";
import type { TierScore } from "../core/recursion";
import { HALF_COLORS, familyColor } from "../tiers";

type Body = Point & { vx: number; vy: number };
export type Bodies = Map<string, Body>;
type Grab = { neuron: number; id: string } | number;
export const GROUP_COLORS = ["#0a9d62", "#9d4edd", "#f77f00"];
export const groupName = (model: NetworkModel, mask: number) =>
  `{${members(mask, model.nodes.length)
    .map((i) => model.nodes[i].label)
    .join(", ")}}`;

const FADE = 700;
const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
const radius = (n: number) => (n > 10 ? 17 : 26);

/** Place new neurons near the neurons they read, so a clone appears beside its parent. */
function place(model: NetworkModel, bodies: Bodies) {
  const n = model.nodes.length;
  model.nodes.forEach((node, i) => {
    if (bodies.has(node.id)) return;
    const near = node.inputs.flatMap((j) => bodies.get(model.nodes[j].id) ?? []);
    const base = near.length
      ? { x: near.reduce((s, p) => s + p.x, 0) / near.length, y: near.reduce((s, p) => s + p.y, 0) / near.length }
      : { x: W / 2 + Math.cos((i * 2 * Math.PI) / n) * 150, y: H / 2 + Math.sin((i * 2 * Math.PI) / n) * 120 };
    bodies.set(node.id, { x: base.x + Math.random() * 40 - 20, y: base.y + Math.random() * 40 - 20, vx: 0, vy: 0 });
  });
}

/** One physics frame: neurons repel, links pull like springs, and stronger or two-way links pull harder. */
function settle(model: NetworkModel, influences: number[][], bodies: Bodies, pinned?: string) {
  place(model, bodies);
  const list = model.nodes.map((node) => bodies.get(node.id)!);
  const n = list.length,
    r = radius(n),
    rest = r * 5;
  for (const b of list) {
    b.vx += (W / 2 - b.x) * 0.0015;
    b.vy += (H / 2 - b.y) * 0.0015;
  }
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const a = list[i],
        b = list[j];
      const dx = b.x - a.x,
        dy = b.y - a.y,
        d = Math.max(8, Math.hypot(dx, dy));
      const pull = influences[i][j] + influences[j][i];
      const force = 5000 / (d * d) - pull * 0.012 * (d - rest);
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
    b.x = Math.max(r + 12, Math.min(W - r - 12, b.x + b.vx));
    b.y = Math.max(r + 30, Math.min(H - r - 12, b.y + b.vy));
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

function outline(points: Point[], padding: number): string {
  if (points.length === 1) {
    const [{ x, y }] = points;
    return `M ${x - padding},${y} A ${padding},${padding} 0 1 0 ${x + padding},${y} A ${padding},${padding} 0 1 0 ${x - padding},${y} Z`;
  }
  const vertices = hull(points);
  if (vertices.length <= 2) {
    const [a, b = a] = vertices;
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

const centroid = (points: Point[]): Point => ({
  x: points.reduce((s, p) => s + p.x, 0) / points.length,
  y: points.reduce((s, p) => s + p.y, 0) / points.length,
});

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

const selfLoop = (p: Point, size: number): Point[] => [
  { x: p.x - size * 0.4, y: p.y - size * 0.5 },
  { x: p.x - size * 1.4, y: p.y - size * 2 },
  { x: p.x + size * 1.4, y: p.y - size * 2 },
  { x: p.x + size * 0.4, y: p.y - size * 0.5 },
];

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
  onWorld,
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
  onWorld: (world: World) => void;
}) {
  const ghosts = useRef<(Point & { at: number; id: string })[]>([]);
  const ids = useRef<string[]>([]);
  const latest = useRef({ model, influences });
  latest.current = { model, influences };
  const drag = useRef<{ grab: Grab; moved: boolean; start: Point } | null>(null);
  const tickStart = useRef(0);
  const [now, setNow] = useState(0);
  const svg = useRef<SVGSVGElement>(null);
  const marker = useId().replaceAll(":", "");

  useEffect(() => {
    tickStart.current = performance.now();
  }, [tick]);

  useEffect(() => {
    const present = new Set(model.nodes.map((node) => node.id));
    for (const id of ids.current)
      if (!present.has(id)) {
        const body = bodies.get(id);
        if (body) ghosts.current.push({ x: body.x, y: body.y, at: performance.now(), id });
        bodies.delete(id);
      }
    ids.current = [...present];
  }, [model, bodies]);

  useEffect(() => {
    let frame = requestAnimationFrame(function animate(time) {
      const grab = drag.current?.grab;
      settle(latest.current.model, latest.current.influences, bodies, typeof grab === "object" ? grab.id : undefined);
      ghosts.current = ghosts.current.filter((g) => time - g.at < FADE);
      setNow(time);
      frame = requestAnimationFrame(animate);
    });
    return () => cancelAnimationFrame(frame);
  }, [bodies]);

  place(model, bodies);
  const at = model.nodes.map((node) => bodies.get(node.id)!);
  const n = model.nodes.length;
  const r = radius(n);
  const state = history[history.length - 1];
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

  const edges = influences.flatMap((row, i) =>
    row.flatMap((weight, j) =>
      weight < 1e-10
        ? []
        : [{ i, j, weight, pts: i === j ? selfLoop(at[i], r * 1.6) : arc(at[i], at[j], influences[j][i] > 1e-10 ? 22 : 0, r + 4) }],
    ),
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
      aria-label="Neuron network. Click a neuron to edit its rule. Drag neurons and food."
      onPointerMove={(event) => {
        const d = drag.current;
        if (!d) return;
        const p = pointAt(event);
        if (Math.hypot(p.x - d.start.x, p.y - d.start.y) > 3) d.moved = true;
        if (typeof d.grab === "number") {
          const k = d.grab;
          onWorld({ ...world, food: world.food.map((f, i) => (i === k ? { ...f, ...p } : f)) });
        } else Object.assign(bodies.get(d.grab.id) ?? {}, p);
      }}
      onPointerUp={() => {
        const d = drag.current;
        if (d && typeof d.grab === "object" && !d.moved) onNeuron(d.grab.neuron);
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
          markerWidth="10"
          markerHeight="10"
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
      {world.lit && (
        <g className="sun" transform={`translate(${sunAt(world).x},${sunAt(world).y})`}>
          <circle r={LIGHT_RANGE} fill={`url(#${marker}-sun)`} />
          <circle className="zone cold" r={LIGHT_RANGE * (1 - COLD)} />
          <circle className="zone hot" r={LIGHT_RANGE * (1 - HOT)} />
          <circle className="sun-disc" r={14}>
            <title>Light warms. It circles the edge.</title>
          </circle>
        </g>
      )}
      {world.food.map((f, k) => (
        <g key={k} className="food" transform={`translate(${f.x},${f.y})`}>
          <circle className="zone smell" r={SMELL_RANGE} />
          <rect
            x={-9}
            y={-9}
            width={18}
            height={18}
            transform={`rotate(45) scale(${0.5 + f.amount / 2})`}
            onPointerDown={grab(k)}
          >
            <title>Food feeds neurons that fire near it. Drag it.</title>
          </rect>
        </g>
      ))}
      {outlines.map(({ mask, color, bold }, k) => {
        const group = members(mask, n);
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
          className={`edge ${dim(i, j) ? "dim" : ""}`}
          d={curve(pts)}
          fill="none"
          stroke={cross(i, j) ? HALF_COLORS[half[i]] : on(i) ? "var(--ink)" : "var(--wire)"}
          strokeOpacity={cross(i, j) && !on(i) ? 0.45 : 1}
          strokeWidth={(cross(i, j) ? 4 : 1.5) + weight * 3}
          markerEnd={`url(#${marker})`}
        >
          <title>
            {model.nodes[j].label} reads {model.nodes[i].label}
          </title>
        </path>
      ))}
      {phase > 0 &&
        edges
          .filter(({ i, j }) => on(i) && !dim(i, j))
          .map(({ i, j, pts }) => {
            const p = bezier(pts, travel);
            return (
              <circle
                key={`${i}-${j}`}
                className="pulse"
                cx={p.x}
                cy={p.y}
                r={cross(i, j) ? 7 : 4.5}
                style={cross(i, j) ? { fill: HALF_COLORS[half[i]] } : undefined}
              />
            );
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
              {node.label} · energy {e.toFixed(2)} · {feel}
            </title>
            <g className="spawn">
              <circle className="halo" r={r + 11} />
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
              <text textAnchor="middle" dy="0.35em" fontSize={r > 20 ? 18 : 12}>
                {node.label.length > 5 ? node.label.slice(0, 4) + "…" : node.label}
              </text>
              {node.sense ? (
                <text className="sense" x={r * 0.72} y={-r * 0.72} textAnchor="middle" dy="0.35em">
                  {SENSES[node.sense]}
                </text>
              ) : (
                <circle className="family" cx={r * 0.72} cy={-r * 0.72} r={r > 20 ? 7 : 5} fill={familyColor(familyOf(node.label))} />
              )}
            </g>
          </g>
        );
      })}
    </svg>
  );
}
