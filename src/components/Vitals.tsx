import { HISTORY, MAX_POPULATION } from "../core/evolve";

export interface Vital {
  neurons: number;
  loop: number;
}

const W = 600,
  H = 34;

function Strip({ name, values, max, format }: { name: string; values: number[]; max: number; format: (v: number) => string }) {
  const x = (k: number) => (k / (HISTORY - 1)) * W;
  const y = (v: number) => H - 3 - (Math.min(v, max) / max) * (H - 6);
  const offset = HISTORY - values.length;
  const last = values[values.length - 1];
  return (
    <div className="strip">
      <span>{name}</span>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${name}, last ${values.length} ticks`}>
        <line x1={0} x2={W} y1={H - 3} y2={H - 3} className="baseline" />
        <polyline points={values.map((v, k) => `${x(offset + k)},${y(v)}`).join(" ")} />
        <title>{values.map(format).join(" · ")}</title>
      </svg>
      <b>{last === undefined ? "–" : format(last)}</b>
    </div>
  );
}

/** Population and strongest live loop, one point per tick. */
export default function Vitals({ vitals }: { vitals: Vital[] }) {
  return (
    <div className="vitals" aria-label="Vitals">
      <Strip name="neurons" values={vitals.map((v) => v.neurons)} max={MAX_POPULATION} format={String} />
      <Strip name="best loop" values={vitals.map((v) => v.loop)} max={1} format={(v) => `${v.toFixed(2)} bit`} />
    </div>
  );
}
