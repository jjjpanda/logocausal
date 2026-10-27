import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties, PointerEvent } from "react";
import { COLD, H, HOT, LIGHT_RANGE, MAX_FOOD_AMOUNT, SPLIT_ENERGY, START_ENERGY, SUN_SPEED, feedRadius, processRate, senseRadius, sunAt, temperature, tired, worldBounds } from "../core/evolve";
import type { Bounds, Energy, Point, World } from "../core/evolve";
import { members } from "../core/model";
import { GATES, gateOf } from "../core/gates";
import type { NetworkModel } from "../core/model";
import type { TierScore } from "../core/recursion";
import { HALF_COLORS } from "../tiers";

import { centroid, place, radius } from "../core/physics";
import type { Bodies } from "../core/physics";
export type { Bodies } from "../core/physics";

type Grab = { neuron: number; id: string };
export const GROUP_COLORS = ["#0a9d62", "#9d4edd", "#f77f00"];
export const groupName = (model: NetworkModel, mask: number) =>
  `{${members(mask, model.nodes.length).map((i) => model.nodes[i].label).join(", ")}}`;
const FADE = 900;
const SIGNAL_TRAIL = 650;
const SIGNAL_AFTERGLOW = 240;
const SIGNAL_HISTORY = 12;
const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

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
  onResize,
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
  onResize: (bounds: Bounds, minimumNeuronRadius: number) => void;
  outlines: { mask: number; color: string; bold: boolean }[];
  focus?: TierScore;
  selectedNeuron: number | null;
  onNeuron: (index: number) => void;
}) {
  const state = history[history.length - 1];
  const calm = running && period <= 1000 / 6;
  const activity = model.nodes.map((_, i) => {
    const recent = history.slice(-SIGNAL_HISTORY);
    return recent.reduce((sum, mask) => sum + ((mask >>> i) & 1), 0) / recent.length;
  });
  const heatHistory = useRef(new Map<string, { tick: number; values: number[] }>());
  const afterglow = useRef(new Map<string, number>());
  const signalFlights = useRef<{ from: string; to: string; at: number; key: string }[]>([]);
  const signalTick = useRef(tick);
  const ghosts = useRef<(Point & { at: number; id: string })[]>([]);
  const births = useRef<(Point & { at: number; id: string })[]>([]);
  const reaches = useRef<{ fromId: string; toId: string; at: number; key: string }[]>([]);
  const prevLinks = useRef<Set<string>>(new Set());
  const ids = useRef<string[]>([]);
  const latest = useRef({ model, influences, state, world, onResize });
  latest.current = { model, influences, state, world, onResize };
  const drag = useRef<{ grab: Grab; moved: boolean; start: Point } | null>(null);
  const tickStart = useRef(0);
  const displayed = useRef(new Map<string, Point>());
  const [now, setNow] = useState(0);
  const svg = useRef<SVGSVGElement>(null);
  const marker = useId().replaceAll(":", "");

  useEffect(() => {
    const element = svg.current!;
    const resize = () => {
      const { width, height } = element.getBoundingClientRect();
      if (width > 0 && height > 0) latest.current.onResize({ width: H * width / height, height: H }, 22 * H / height);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    tickStart.current = performance.now();
  }, [tick]);

  useEffect(() => {
    if (!running || !calm || tick < signalTick.current) signalFlights.current = [];
    if (tick < signalTick.current) afterglow.current.clear();
    if (tick === signalTick.current) return;
    signalTick.current = tick;
    if (!running || !calm || reducedMotion() || history.length < 2) return;
    const time = performance.now();
    const previous = history.at(-2)!;
    const starts = new Set(model.nodes.flatMap((node, i) =>
      ((state >>> i) & 1) && !((previous >>> i) & 1) ? [node.id] : []));
    starts.forEach(id => afterglow.current.set(id, time));
    model.nodes.forEach(node => node.inputs.forEach(i => {
      const source = model.nodes[i];
      if (!starts.has(source.id)) return;
      // Coalesce very rapid starts, and bound the number of visual packets.
      if (signalFlights.current.some(f => f.from === source.id && f.to === node.id && time - f.at < 160)) return;
      signalFlights.current.push({ from: source.id, to: node.id, at: time, key: `${source.id}-${node.id}-${tick}` });
    }));
    signalFlights.current = signalFlights.current.slice(-48);
  }, [tick, running, calm, model, history, state]);

  useEffect(() => {
    const present = new Set(model.nodes.map(node => node.id));
    for (const id of heatHistory.current.keys()) if (!present.has(id)) heatHistory.current.delete(id);
    for (const id of afterglow.current.keys()) if (!present.has(id)) afterglow.current.delete(id);
    model.nodes.forEach((node, i) => {
      const p = bodies.get(node.id);
      if (!p) return;
      const previous = heatHistory.current.get(node.id);
      if (previous?.tick === tick) return;
      heatHistory.current.set(node.id, { tick, values: [...(previous?.values ?? []), temperature(world, p, history, i, node.id)].slice(-8) });
    });
  }, [tick, model, world, history, bodies]);

  useEffect(() => {
    displayed.current.clear();
  }, [world.bounds]);

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
        displayed.current.delete(id);
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
      // Rendering follows authoritative tick positions; frame rate never changes the ecology.
      for (const [id, body] of bodies) {
        const previous = displayed.current.get(id) ?? body;
        const follow = running && drag.current?.grab.id !== id ? 0.24 : 1;
        displayed.current.set(id, { x: previous.x + (body.x - previous.x) * follow, y: previous.y + (body.y - previous.y) * follow });
      }

      ghosts.current = ghosts.current.filter((g) => time - g.at < FADE);
      births.current = births.current.filter((b) => time - b.at < FADE);
      reaches.current = reaches.current.filter((rc) => time - rc.at < FADE);
      signalFlights.current = signalFlights.current.filter(f => time - f.at < SIGNAL_TRAIL);
      setNow(time);
      frame = requestAnimationFrame(animate);
    });
    return () => cancelAnimationFrame(frame);
  }, [bodies, running]);

  place(model, bodies, world);
  const at = model.nodes.map((node) => displayed.current.get(node.id) ?? bodies.get(node.id)!);
  const n = model.nodes.length;
  const { width, height } = worldBounds(world);
  const r = radius(n, world);
  const on = (i: number) => (state >>> i) & 1;
  const phase = running && !reducedMotion() ? Math.min(1, (now - tickStart.current) / period) : 0;
  const travel = ease(phase);
  const pointAt = (event: PointerEvent<SVGElement>): Point => {
    const point = svg.current!.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const p = point.matrixTransform(svg.current!.getScreenCTM()!.inverse());
    const marginX = Math.min(r, width / 2), marginY = Math.min(r, height / 2);
    return { x: Math.max(marginX, Math.min(width - marginX, p.x)), y: Math.max(marginY, Math.min(height - marginY, p.y)) };
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
      return [{ i, j, weight, pts: arc(at[i], at[j], mutual ? 24 : 0, r * 1.3) }];
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
      viewBox={`0 0 ${width} ${height}`}
      className={`network-svg ${calm ? "calm" : ""}`}
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
      {(() => {
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
          <title>Food: {f.amount.toFixed(2)} / {MAX_FOOD_AMOUNT}. Brighter green means more food.</title>
          <circle className="zone smell" r={senseRadius(f)} />
          <circle className="zone feed" r={feedRadius(f)} style={{ fillOpacity: 0.025 + 0.14 * f.amount / MAX_FOOD_AMOUNT, strokeOpacity: 0.3 + 0.7 * f.amount / MAX_FOOD_AMOUNT }} />
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
            fillOpacity={calm ? 0.07 : 0.03 + lit * 0.12}
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
          className={`edge ${dim(i, j) ? "dim" : ""} ${!calm && on(i) ? "active" : ""}`}
          d={curve(pts)}
          fill="none"
          stroke={cross(i, j) ? HALF_COLORS[half[i]] : !calm && on(i) ? "var(--ink)" : "var(--wire)"}
          strokeOpacity={cross(i, j) && (calm || !on(i)) ? 0.65 : 1}
          strokeWidth={(cross(i, j) ? 4.5 : 2.5) + weight * 2.5}
          markerEnd={`url(#${marker})`}
        >
          <title>
            {model.nodes[j].label} connects to {model.nodes[i].label}
          </title>
        </path>
      ))}
      {!calm && reaches.current.map((rc) => {
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
      {!calm && phase > 0 &&
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
      {calm && running && !reducedMotion() && signalFlights.current.map(flight => {
        const edge = edges.find(({ i, j }) => model.nodes[i].id === flight.from && model.nodes[j].id === flight.to);
        if (!edge) return null;
        const t = Math.max(0, Math.min(1, (now - flight.at) / SIGNAL_TRAIL));
        const color = half[edge.i] >= 0 ? HALF_COLORS[half[edge.i]] : "var(--signal)";
        return <g className="signal-flight" key={flight.key} aria-hidden="true" opacity={dim(edge.i, edge.j) ? 0.55 : 1}>
          {[0.16, 0.08, 0].map((lag, k) => {
            if (t < lag) return null;
            const p = bezier(edge.pts, ease(t - lag));
            return <circle key={lag} cx={p.x} cy={p.y} r={3 + k * 1.4} fill={color} opacity={0.25 + k * 0.35} />;
          })}
        </g>;
      })}
      {!reducedMotion() && births.current.map((b) => {
        const t = (now - b.at) / FADE;
        return <circle key={b.id} className="birth" cx={b.x} cy={b.y} r={r * (0.8 + t * 2)} opacity={1 - t} />;
      })}
      {!reducedMotion() && ghosts.current.map((g) => {
        const t = (now - g.at) / FADE;
        return <circle key={g.id} className="ghost" cx={g.x} cy={g.y} r={r * (1 + t * 1.5)} opacity={1 - t} />;
      })}
      {model.nodes.map((node, i) => {
        const actualHeat = temperature(world, at[i], history, i, node.id);
        const recentHeat = heatHistory.current.get(node.id)?.values;
        const heat = calm && recentHeat?.length ? recentHeat.reduce((sum, value) => sum + value, 0) / recentHeat.length : actualHeat;
        const e = energy[node.id] ?? START_ENERGY;
        const feel = heat < COLD ? "cold" : heat > HOT ? "hot" : "ok";
        const resting = !calm && tired(history, i, world, node.id);
        const low = e < SPLIT_ENERGY * 0.3;
        const status = feel === "cold" ? (calm ? "Cold" : `Cold · ${Math.round(processRate(heat) * 100)}%`) : feel === "hot" ? "Too hot" : low ? "Low energy" : resting ? "Resting" : calm ? (activity[i] > 0 ? "Active" : "Quiet") : on(i) ? "On" : "Off";
        const gate = gateOf(node.inputs.length, node.table);
        const role = node.sense ? (node.sense === "light" ? "Light" : "Food") : gate ? GATES[gate].name.replace("always ", "Constant ") : "Logic";
        const description = `Neuron ${node.label}. ${node.sense ? `Senses ${node.sense}` : role}.${node.push ? ` Moves toward ${node.push}.` : ""} ${status}.${calm ? ` ${Math.round(activity[i] * 100)}% on over the last ${Math.min(SIGNAL_HISTORY, history.length)} ticks; history bars read left to right. Trails show recent signal starts.` : ""} Energy ${e.toFixed(2)} of ${SPLIT_ENERGY}.`;
        const descriptionId = `${marker}-neuron-${i}`;
        const glow = reducedMotion() ? activity[i] * 0.6 : Math.max(0, Math.min(1, 1 - (now - (afterglow.current.get(node.id) ?? -Infinity)) / SIGNAL_AFTERGLOW)) * 0.75;
        return (
          <g
            key={node.id}
            className={`graph-node ${!calm && on(i) ? "on" : ""} ${resting ? "tired" : ""} ${feel} ${low ? "low-energy" : ""} ${selectedNeuron === i ? "selected" : ""}`}
            style={calm ? { "--activity": `${Math.round(glow * 100)}%` } as CSSProperties : undefined}
            role="button"
            tabIndex={0}
            aria-label={`Edit neuron ${node.label}`}
            aria-describedby={descriptionId}
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
            <title>{description}</title>
            <desc id={descriptionId}>{description}</desc>
            <g className="spawn">
              <circle className="node-hit-area" r={r * 1.5} />
              <circle className="neuron-body" r={r} style={rim(i)} />
              <circle className="energy-track" r={r * 1.16} />
              <circle
                className={`energy ${feel} ${low ? "low" : ""}`}
                r={r * 1.16}
                pathLength={1}
                strokeDasharray={`${Math.max(0, Math.min(1, e / SPLIT_ENERGY))} 1`}
                transform="rotate(-90)"
              />
              <text className="node-name" textAnchor="middle" y={r * 0.34} style={{ fontSize: r * (node.label.length > 3 ? 0.65 : 1) }}>
                {node.label.length > 5 ? `${node.label.slice(0, 4)}…` : node.label}
              </text>
              {calm && <g className="signal-history" aria-hidden="true">
                {Array.from({ length: SIGNAL_HISTORY }, (_, k) => {
                  const sample = history.at(-(SIGNAL_HISTORY - k));
                  return <rect key={k} x={r * (-0.72 + k * 0.12)} y={r * 0.64} width={r * 0.095} height={r * 0.14} rx={r * 0.025}
                    className={sample === undefined ? "empty" : (sample >>> i) & 1 ? "on" : ""} />;
                })}
              </g>}
              <text className="node-caption" textAnchor="middle" y={r * 1.7} style={{ fontSize: r * 0.46 }}>
                <tspan className="node-role">{role}</tspan>{node.push && <tspan className="node-motion"> ↗<title>Moves toward {node.push}</title></tspan>}
              </text>
            </g>
          </g>
        );
      })}
    </svg>
  );
}
