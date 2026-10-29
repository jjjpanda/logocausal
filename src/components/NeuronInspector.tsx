import { COLD, ENERGY_CAP, HOT, SPLIT_ENERGY, START_ENERGY, processRate, temperature, tired } from "../core/evolve";
import type { Energy, LifeEvent, Metabolism, World } from "../core/evolve";
import type { BinaryNode, NetworkModel } from "../core/model";
import type { Bodies } from "../core/physics";
import RuleEditor from "./RuleEditor";

export interface NeuronSample {
  node: BinaryNode;
  readIds: string[];
  on: boolean;
  energy: number;
  heat: number;
  budget?: Metabolism;
}
export interface Frame { tick: number; neurons: Record<string, NeuronSample> }
export type RecordedEvent = LifeEvent & { tick: number; id: string; parentId?: string };

export default function NeuronInspector({ model, selectedId, onSelect, history, energy, world, bodies, frames, events, onChange, onRemove }: {
  model: NetworkModel; selectedId: string | null; onSelect: (id: string) => void;
  history: number[]; energy: Energy; world: World; bodies: Bodies; frames: Frame[]; events: RecordedEvent[];
  onChange: (index: number, node: BinaryNode) => void; onRemove: (index: number) => void;
}) {
  const index = model.nodes.findIndex(n => n.id === selectedId);
  const archived = new Map<string, BinaryNode>();
  for (const frame of frames) for (const [id, sample] of Object.entries(frame.neurons)) {
    if (!model.nodes.some(n => n.id === id)) archived.set(id, sample.node);
  }
  const samples = selectedId ? frames.flatMap(f => f.neurons[selectedId] ? [{ ...f.neurons[selectedId], tick: f.tick }] : []) : [];
  const last = samples.at(-1);
  const node = model.nodes[index] ?? last?.node;
  const alive = index >= 0;
  const on = alive ? !!((history.at(-1)! >>> index) & 1) : last?.on;
  const fuel = alive ? (energy[node.id] ?? START_ENERGY) : (last?.energy ?? 0);
  const position = node && bodies.get(node.id);
  const heat = alive && position ? temperature(world, position, history, index, node.id) : last?.heat;
  const rate = heat === undefined ? undefined : processRate(heat);
  const feel = heat === undefined ? "Pending" : heat < COLD ? "Cold" : heat > HOT ? "Hot" : "Comfortable";
  const related = events.filter(e => e.id === selectedId || e.parentId === selectedId);
  const budget = last?.budget;
  const delta = budget?.delta;
  const outputs = alive ? model.nodes.filter(n => n.inputs.includes(index)) : [];
  const points = samples.map((s, i) => `${samples.length < 2 ? 0 : i / (samples.length - 1) * 300},${44 - Math.min(ENERGY_CAP, s.energy) / ENERGY_CAP * 40}`).join(" ");
  const splitY = 44 - SPLIT_ENERGY / ENERGY_CAP * 40;
  return (
    <section className="panel inspector" aria-label="Neuron details">
      <div className="panel-heading"><h2>Neuron details</h2></div>
      <div className="panel-scroll">
        <div className="neuron-selector">
          <label htmlFor="neuron-select">Selected neuron</label>
          <select id="neuron-select" value={node ? selectedId! : ""} onChange={e => onSelect(e.target.value)}>
            <option value="" disabled>Select a neuron</option>
            <optgroup label="Living">{model.nodes.map(n => <option key={n.id} value={n.id}>Neuron {n.label}</option>)}</optgroup>
            {archived.size > 0 && <optgroup label="Recent deceased">{[...archived].map(([id, n]) => <option key={id} value={id}>Neuron {n.label} · died</option>)}</optgroup>}
          </select>
        </div>
        {node ? <>
          <div className="neuron-title"><strong>Neuron {node.label}</strong><span className={`state-badge ${alive && on ? "is-on" : ""}`}>{!alive ? "Died" : tired(history, index, world, node.id) ? "Resting" : on ? "Firing" : "Quiet"}</span></div>
          <div className="neuron-metrics">
            <div><span>Energy</span><strong>{fuel.toFixed(2)}<small> / {ENERGY_CAP.toFixed(2)}</small></strong><meter aria-label="Neuron energy" min={0} max={ENERGY_CAP} value={fuel} /><small>Divides at {SPLIT_ENERGY.toFixed(2)}</small></div>
            <div><span>Temperature</span><strong>{heat?.toFixed(2) ?? "—"}</strong><small className={feel === "Cold" ? "cold-text" : feel === "Hot" ? "hot-text" : ""}>{feel}{rate !== undefined && rate < 1 ? ` · ${Math.round(rate * 100)}% speed` : ""}</small></div>
            <div><span>Energy / tick</span><strong className={delta !== undefined && delta >= 0 ? "positive" : ""}>{delta === undefined ? "—" : `${delta >= 0 ? "+" : ""}${delta.toFixed(3)}`}</strong><small>before reproduction</small></div>
            <div><span>Connections</span><strong>{alive ? node.inputs.length : "—"}<small> in / {alive ? outputs.length : "—"} out</small></strong><small>{node.sense ? `Senses ${node.sense}` : "Logic"}{node.push ? ` · moves to ${node.push}` : ""}</small></div>
          </div>
          <div className="history-heading"><h3>Activity history</h3><span>{samples.length} ticks retained</span></div>
          {samples.length ? <div className="neuron-history" aria-label={`Activity history for ${node.label}`}>
            <div className="activity-bits" role="img" aria-label={`${samples.filter(s => s.on).length} of ${samples.length} recorded ticks firing`}>
              {samples.map(s => <i key={s.tick} className={s.on ? "on" : ""} title={`T${s.tick} · ${s.on ? "on" : "off"} · energy ${s.energy.toFixed(2)}`} />)}
            </div>
            <svg viewBox="0 0 300 48" preserveAspectRatio="none" role="img" aria-label={`Energy history for ${node.label}`}><line x1="0" x2="300" y1={splitY} y2={splitY} className="split-line" /><polyline points={points} /></svg>
            <div className="history-axis"><span>T{samples[0].tick}</span><span>Energy trace</span><span>T{samples.at(-1)!.tick}</span></div>
          </div> : <p className="hint">History starts on the next simulation tick.</p>}
          {budget && <details className="energy-details"><summary>Energy budget <span>per tick</span></summary><dl className="budget">
            {[["Food", budget.intake], ["Live loop", budget.loop], ["Link sharing", budget.sharing], ["Upkeep", -budget.upkeep], ["Firing", -budget.firing], ["Exposure", -budget.exposure], ["Storage overflow", -budget.overflow]].map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{Number(value) > 0 ? "+" : ""}{Number(value).toFixed(3)}</dd></div>)}
          </dl></details>}
          {alive && <details className="rule-details" open><summary>Rule & connections</summary><RuleEditor key={node.id} model={model} index={index} onChange={next => onChange(index, next)} onRemove={() => onRemove(index)} /><p className="hint output-list">Read by: {outputs.map(n => n.label).join(", ") || "none"}</p></details>}
          <div className="history-heading"><h3>Life history</h3></div>
          {related.length ? <ol className="log" aria-label={`Life history for ${node.label}`}>{related.map((e, k) => <li key={k} className={e.kind}><span>T{e.tick}</span> {e.kind === "born" ? `${e.parent} → ${e.label}` : `${e.label} ${e.cause}`}</li>)}</ol> : <p className="hint">No births or deaths recorded for this neuron.</p>}
          <p className="hint history-retention">Activity and energy retain the last 96 simulation ticks. Life events retain the latest 96 births and deaths. History resets with a new population or reload.</p>
        </> : <div className="inspector-empty"><h3>Select a neuron.</h3><p>Click a neuron in the network to inspect its activity, energy, and connections.</p>{!model.nodes.length && <p>Use <b>Random gen</b> to seed a population.</p>}</div>}
      </div>
    </section>
  );
}
