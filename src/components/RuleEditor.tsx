import { GATES, bitsOf, gateOf, gatesFor, tableFor } from "../core/gates";
import type { Gate } from "../core/gates";
import { MAX_INPUTS, SENSES } from "../core/model";
import type { BinaryNode, NetworkModel, Sense } from "../core/model";

const SENSE_NAME: Record<Sense, string> = { light: "senses light", food: "smells food" };

export default function RuleEditor({
  model,
  index,
  onChange,
  onRemove,
}: {
  model: NetworkModel;
  index: number;
  onChange: (node: BinaryNode) => void;
  onRemove: () => void;
}) {
  const node = model.nodes[index];
  const names = node.inputs.map((i) => model.nodes[i].label);
  const gate = node.sense ? undefined : gateOf(node.inputs.length, node.table);
  const apply = (inputs: number[], next: Gate) =>
    onChange({ id: node.id, label: node.label, inputs, table: tableFor(next, inputs.length) });
  const pick = (value: string) =>
    value in SENSES
      ? onChange({ id: node.id, label: node.label, inputs: [], table: [0], sense: value as Sense })
      : apply(node.inputs, value as Gate);
  const setInputs = (inputs: number[]) => apply(inputs, gatesFor(inputs.length)[0]);
  const addable = model.nodes.map((_, i) => i).filter((i) => !node.inputs.includes(i));
  return (
    <div className="rule-row">
      <code className="formula">
        {node.label}′ = {node.sense ? SENSES[node.sense] : gate ? GATES[gate].show(names) : "custom"}
      </code>
      <select aria-label={`Rule for ${node.label}`} value={node.sense ?? gate ?? "custom"} onChange={(event) => pick(event.target.value)}>
        {!gate && !node.sense && (
          <option value="custom" disabled>
            custom rule
          </option>
        )}
        {gatesFor(node.inputs.length).map((g) => (
          <option key={g} value={g}>
            {GATES[g].name}
          </option>
        ))}
        {(Object.keys(SENSES) as Sense[]).map((s) => (
          <option key={s} value={s}>
            {SENSE_NAME[s]}
          </option>
        ))}
      </select>
      <button
        className="text-button danger"
        aria-label={`Remove ${node.label}`}
        disabled={model.nodes.length <= 2}
        onClick={onRemove}
      >
        remove
      </button>
      {!node.sense && (
        <span className="chips" role="group" aria-label={`Inputs of ${node.label}`}>
          <span>reads</span>
          {node.inputs.map((input) => (
            <button
              key={input}
              aria-label={`Stop reading ${model.nodes[input].label} in ${node.label}`}
              onClick={() => setInputs(node.inputs.filter((i) => i !== input))}
            >
              {model.nodes[input].label} ×
            </button>
          ))}
          {node.inputs.length < MAX_INPUTS && addable.length > 0 && (
            <select
              aria-label={`Add input to ${node.label}`}
              value=""
              onChange={(event) => setInputs([...node.inputs, Number(event.target.value)].sort((a, b) => a - b))}
            >
              <option value="" disabled>
                + add
              </option>
              {addable.map((i) => (
                <option key={i} value={i}>
                  {model.nodes[i].label}
                </option>
              ))}
            </select>
          )}
        </span>
      )}
      {!node.sense && (
        <details className="truth">
          <summary>truth table</summary>
          <table>
            <thead>
              <tr>
                {names.map((name) => (
                  <th key={name}>{name}</th>
                ))}
                <th>{node.label}′</th>
              </tr>
            </thead>
            <tbody>
              {node.table.map((out, row) => (
                <tr key={row}>
                  {bitsOf(row, node.inputs.length).map((bit, k) => (
                    <td key={k}>{bit}</td>
                  ))}
                  <td className={out ? "on" : ""}>{out}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}
