const any = (bits: number[]) => Number(bits.some(Boolean));
const all = (bits: number[]) => Number(bits.every(Boolean));
const odd = (bits: number[]) => bits.reduce((a, b) => a ^ b, 0);
const infix = (symbol: string, negate = false) => (names: string[]) => {
  const body = names.join(` ${symbol} `);
  return negate ? `¬(${body})` : body;
};

export const GATES = {
  off: { name: "always 0", fn: () => 0, show: () => "0" },
  on: { name: "always 1", fn: () => 1, show: () => "1" },
  same: { name: "copy", fn: ([a]: number[]) => a, show: ([a]: string[]) => a },
  not: { name: "NOT", fn: ([a]: number[]) => 1 - a, show: ([a]: string[]) => `¬${a}` },
  or: { name: "OR", fn: any, show: infix("∨") },
  and: { name: "AND", fn: all, show: infix("∧") },
  xor: { name: "XOR", fn: odd, show: infix("⊕") },
  nor: { name: "NOR", fn: (bits: number[]) => 1 - any(bits), show: infix("∨", true) },
  nand: { name: "NAND", fn: (bits: number[]) => 1 - all(bits), show: infix("∧", true) },
  xnor: { name: "XNOR", fn: (bits: number[]) => 1 - odd(bits), show: infix("⊕", true) },
};
export type Gate = keyof typeof GATES;

export const gatesFor = (inputs: number): Gate[] =>
  inputs === 0
    ? ["off", "on"]
    : inputs === 1
      ? ["same", "not"]
      : ["or", "and", "xor", "nor", "nand", "xnor"];

export const bitsOf = (row: number, inputs: number) =>
  Array.from({ length: inputs }, (_, i) => (row >>> i) & 1);

export const tableFor = (gate: Gate, inputs: number): number[] =>
  Array.from({ length: 2 ** inputs }, (_, row) => GATES[gate].fn(bitsOf(row, inputs)));

export const gateOf = (inputs: number, table: number[]): Gate | undefined =>
  gatesFor(inputs).find((gate) => tableFor(gate, inputs).every((v, i) => v === table[i]));
