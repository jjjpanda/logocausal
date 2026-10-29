import { useEffect, useMemo, useRef, useState } from "react";
import { describeActivity, describeMachine } from "../core/machine";
import { members } from "../core/model";
import type { NetworkModel } from "../core/model";
import type { Frame } from "./NeuronInspector";

export default function GroupMachine({ model, mask, history, frames, running }: {
  model: NetworkModel; mask: number; history: number[]; frames: Frame[]; running: boolean;
}) {
  const current = useMemo(() => describeMachine(model, mask), [model, mask]);
  const group = members(mask, model.nodes.length);
  const identity = JSON.stringify(group.map(i => model.nodes[i].id).sort());
  const signature = JSON.stringify(current);
  const latest = useRef(current);
  latest.current = current;
  const [settled, setSettled] = useState({ identity, signature, machine: current });
  useEffect(() => {
    const commit = () => setSettled({ identity, signature, machine: latest.current });
    // A new group and paused inspection must never inherit another circuit's label.
    if ((!running || settled.identity !== identity) && (settled.identity !== identity || settled.signature !== signature)) { commit(); return; }
    if (settled.signature === signature) return;
    const timer = setTimeout(commit, 1500);
    return () => clearTimeout(timer);
  }, [identity, signature, running, settled]);
  const machine = !running || settled.identity !== identity ? current : settled.machine;
  const changing = running && settled.identity === identity && settled.signature !== signature;
  // Preserve observations through unrelated rewiring, but never mix this group's old rules.
  let compatible = 0;
  for (let t = frames.length - 1; t >= 0; t--) {
    if (!group.every(i => {
      const node = model.nodes[i], sample = frames[t].neurons[node.id];
      return sample && sample.node.sense === node.sense && sample.node.table.join() === node.table.join()
        && sample.readIds.length === node.inputs.length
        && sample.readIds.every((id, k) => id === model.nodes[node.inputs[k]].id);
    })) break;
    compatible++;
  }
  const validHistory = compatible ? history.slice(-compatible) : [];
  const patterns = validHistory.map(state => state & mask);
  const recent = validHistory.slice(-24);
  return <section className="machine-description" aria-label="Machine description">
    <h3>Machine type</h3>
    {machine ? <>
      <strong className="machine-name">{machine.name}</strong>
      {changing && <p className="machine-pending" role="status">Circuit changing · showing last settled type</p>}
      <p>{machine.detail}</p>
      <p className="machine-connections">{machine.connections}</p>
      <div className="machine-observation"><b>Live</b><span>{describeActivity(patterns)}</span></div>
      <div className="machine-raster" role="img" aria-label={`Group activity over the last ${recent.length} ticks; newest at right`}>
        {group.map(i => <div className="raster-row" key={model.nodes[i].id}>
          <span>{model.nodes[i].label}</span><div>{Array.from({ length: 24 }, (_, k) => {
            const state = recent[k - (24 - recent.length)];
            return <i key={k} className={state === undefined ? "empty" : (state >>> i) & 1 ? "on" : ""} />;
          })}</div>
        </div>)}
      </div>
      <p className="machine-note">Type describes gate behavior with outside signals held steady. Live activity also includes fatigue, cold and noise.</p>
    </> : <p className="hint">Reading the updated circuit…</p>}
  </section>;
}
