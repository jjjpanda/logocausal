import { useEffect, useMemo, useRef, useState } from "react";
import { describeMachine, largerCircuit } from "../core/machine";
import type { CircuitDescription } from "../core/machine";
import { groupName, members } from "../core/model";
import type { NetworkModel } from "../core/model";
import type { Frame } from "../core/history";
import GroupActivity from "./GroupActivity";

export default function GroupMachine({ model, mask, frames, running, circuits }: {
  model: NetworkModel; mask: number; frames: Frame[]; running: boolean; circuits: CircuitDescription[];
}) {
  const highlighted = JSON.stringify(members(mask, model.nodes.length).map(i => model.nodes[i].id).sort());
  const wholeMask = useMemo(() => largerCircuit(model, mask), [model, mask]);
  const [scope, setScope] = useState({ identity: highlighted, whole: false });
  const inspectingWhole = scope.identity === highlighted && scope.whole && wholeMask !== null;
  const inspectionMask = inspectingWhole ? wholeMask : mask;
  const current = useMemo(() => {
    const whole = circuits.find(circuit => circuit.mask === wholeMask)?.machine
      ?? (wholeMask !== null && members(wholeMask, model.nodes.length).length <= 5 ? describeMachine(model, wholeMask) : null);
    const machine = inspectingWhole ? whole : describeMachine(model, mask);
    const larger = !inspectingWhole && whole
      ? { machine: whole, neurons: members(wholeMask!, model.nodes.length).map(i => ({ id: model.nodes[i].id, label: model.nodes[i].label })) }
      : null;
    return { machine, larger };
  }, [model, mask, wholeMask, inspectingWhole, circuits]);
  const group = members(inspectionMask, model.nodes.length);
  const identity = JSON.stringify(group.map(i => model.nodes[i].id).sort());
  const signature = JSON.stringify(current);
  const latest = useRef({ value: current, signature, identity });
  latest.current = { value: current, signature, identity };
  const [settled, setSettled] = useState(latest.current);
  const changed = settled.signature !== signature;
  useEffect(() => {
    if (!running || settled.identity !== identity) { setSettled(latest.current); return; }
    if (!changed) return;
    // Depend on whether a change is pending, not on each intermediate signature.
    // Continuous rewiring must not postpone a readable update forever.
    const timer = setTimeout(() => setSettled(latest.current), 2000);
    return () => clearTimeout(timer);
  }, [running, identity, settled.identity, changed]);
  const immediate = !running || settled.identity !== identity;
  const description = immediate ? current : settled.value;
  const changing = !immediate && changed;
  const { machine, larger } = description;
  const groupLabel = groupName(model, inspectionMask);
  return <section className="machine-description" aria-label="Machine description">
    <h3>Machine type</h3>
    {inspectingWhole && <div className="machine-scope"><p>Whole circuit · {groupLabel}</p>
      <button className="text-button" onClick={() => setScope({ identity: highlighted, whole: false })}>Back to highlighted group</button></div>}
    {machine ? <>
      <strong className="machine-name">{machine.name}</strong>
      {changing && <p className="machine-pending" role="status">Circuit changing · showing last settled type</p>}
      <p>{machine.detail}</p>
      <p className="machine-connections">{machine.connections}</p>
      {machine.enumeration && <p className="machine-note">{group.length} neurons · {machine.enumeration.states} possible states · {machine.enumeration.inputSettings} held-input settings checked</p>}
      <details className="machine-rules"><summary>Neuron rules</summary>
        <dl>{machine.rules.map(rule => <div key={rule.neuron}>
          <dt>{rule.neuron}: {rule.name}</dt><dd>{rule.detail}</dd>
        </div>)}</dl>
      </details>
    </> : <p className="hint">Reading the updated circuit…</p>}
      <GroupActivity model={model} mask={inspectionMask} frames={frames} />
      {larger && <aside className="machine-context" aria-label="Whole circuit">
        <p>Whole circuit · {`{${larger.neurons.map(n => n.label).join(", ")}}`}</p>
        <strong>{larger.machine.name}</strong>
        <p>{larger.machine.detail}</p>
        <p className="machine-note">Live activity above shows {groupLabel}.</p>
        <button className="text-button" onClick={() => setScope({ identity: highlighted, whole: true })}>Inspect whole circuit</button>
      </aside>}
      <p className="machine-note">Outside inputs held steady; all neurons update together. Capabilities may vary with input settings. Live activity also includes fatigue, cold and noise.</p>
  </section>;
}
