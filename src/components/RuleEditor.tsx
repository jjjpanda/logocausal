import { GATES, gateOf, gatesFor, tableFor } from "../core/gates";
import type { Gate } from "../core/gates";
import { MAX_INPUTS, SENSES } from "../core/model";
import type { BinaryNode, NetworkModel, Sense } from "../core/model";

const SENSE_NAME: Record<Sense, string> = { light: "senses light ☀", food: "senses food ◆" };
const PUSH_NAME: Record<Sense, string> = { light: "moves: light ◎☀", food: "moves: food ◎◆" };

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
  const gate = node.inputs.length > 0 ? gateOf(node.inputs.length, node.table) : undefined;
  const apply = (inputs: number[], next: Gate) =>
    onChange({
      id: node.id,
      label: node.label,
      inputs,
      table: inputs.length === 0 ? [0] : tableFor(next, inputs.length),
      ...(node.sense ? { sense: node.sense } : {}),
      ...(node.push ? { push: node.push } : {}),
    });
  const setSense = (value: string) =>
    onChange({
      id: node.id,
      label: node.label,
      inputs: node.inputs,
      table: node.table,
      ...(value in SENSES ? { sense: value as Sense } : {}),
      ...(node.push ? { push: node.push } : {}),
    });
  const setPush = (value: string) =>
    onChange({
      id: node.id,
      label: node.label,
      inputs: node.inputs,
      table: node.table,
      ...(node.sense ? { sense: node.sense } : {}),
      ...(value in SENSES ? { push: value as Sense } : {}),
    });
  const setInputs = (inputs: number[]) => apply(inputs, gatesFor(inputs.length)[0]);
  const addable = model.nodes.map((_, i) => i).filter((i) => i !== index && !node.inputs.includes(i));
  const logicFormula = node.inputs.length > 0 ? (gate ? GATES[gate].show(names) : "custom") : "";
  const bodyFormula =
    node.sense && logicFormula
      ? `${SENSES[node.sense]} ∨ (${logicFormula})`
      : node.sense
        ? SENSES[node.sense]
        : logicFormula || "0";

  return (
    <div className="rule-row">
      <code className="formula">
        {node.label}′ = {bodyFormula}
        {node.push ? ` ◎${SENSES[node.push]}` : ""}
      </code>
      <button
        className="text-button danger"
        aria-label={`Remove ${node.label}`}
        disabled={model.nodes.length <= 2}
        onClick={onRemove}
      >
        remove
      </button>
      <div className="rule-controls">
        <select aria-label={`Sense for ${node.label}`} value={node.sense ?? ""} onChange={(event) => setSense(event.target.value)}>
          <option value="">no sense</option>
          {(Object.keys(SENSES) as Sense[]).map((s) => (
            <option key={s} value={s}>
              {SENSE_NAME[s]}
            </option>
          ))}
        </select>
        <select aria-label={`Push for ${node.label}`} value={node.push ?? ""} onChange={(event) => setPush(event.target.value)}>
          <option value="">no move</option>
          {(Object.keys(SENSES) as Sense[]).map((s) => (
            <option key={s} value={s}>
              {PUSH_NAME[s]}
            </option>
          ))}
        </select>
        {node.inputs.length > 0 && (
          <select
            aria-label={`Rule for ${node.label}`}
            value={gate ?? gatesFor(node.inputs.length)[0]}
            onChange={(event) => apply(node.inputs, event.target.value as Gate)}
          >
            {gatesFor(node.inputs.length).map((g) => (
              <option key={g} value={g}>
                {GATES[g].name}
              </option>
            ))}
          </select>
        )}
      </div>
      <span className="chips" role="group" aria-label={`Inputs of ${node.label}`}>
        <span>connects</span>
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
              + reach out
            </option>
            {addable.map((i) => (
              <option key={i} value={i}>
                {model.nodes[i].label}
              </option>
            ))}
          </select>
        )}
      </span>
    </div>
  );
}
