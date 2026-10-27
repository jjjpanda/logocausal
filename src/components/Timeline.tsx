import { useEffect, useRef } from "react";
import { familyOf } from "../core/evolve";
import { members } from "../core/model";
import type { NetworkModel } from "../core/model";
import { familyColor } from "../tiers";

export const HISTORY = 96;
const LABEL = 40;

/**
 * Spacetime strip: one row per neuron, one column per tick, newest on the right. Rows of the
 * selected group come first. With two halves, a bar under a cell marks a neuron that copies a neuron
 * of the other half from one tick earlier.
 */
export default function Timeline({
  model,
  history,
  rows,
}: {
  model: NetworkModel;
  history: number[];
  rows: { mask: number; color: string }[];
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const n = model.nodes.length;
  const row = n > 12 ? 14 : 18;
  useEffect(() => {
    const element = canvas.current!;
    const picked = new Set(rows.flatMap(({ mask }) => members(mask, n)));
    const order = [...new Set([...picked, ...model.nodes.keys()])];
    const draw = () => {
      const ratio = window.devicePixelRatio || 1;
      const width = element.clientWidth,
        height = n * row;
      element.width = width * ratio;
      element.height = height * ratio;
      const g = element.getContext("2d");
      if (!g) return;
      g.setTransform(ratio, 0, 0, ratio, 0, 0);
      g.fillStyle = "#fff";
      g.fillRect(0, 0, width, height);
      const cell = (width - LABEL) / HISTORY;
      const start = HISTORY - history.length;
      const bit = (t: number, i: number) => (history[t] >>> i) & 1;
      g.font = `900 ${row > 14 ? 13 : 11}px "Segoe UI", system-ui, sans-serif`;
      g.textBaseline = "middle";
      order.forEach((i, y) => {
        const top = y * row;
        const k = rows.findIndex(({ mask }) => (mask >>> i) & 1);
        const tint = rows[k];
        g.fillStyle = tint?.color ?? familyColor(familyOf(model.nodes[i].label));
        g.fillRect(0, top, tint ? LABEL : 5, row);
        g.fillStyle = tint && tint.color !== "#ffd93d" ? "#fff" : "#000";
        g.fillText(model.nodes[i].label.slice(0, 4), 8, top + row / 2);
        const other = rows.length === 2 ? rows[1 - k] : undefined;
        const sources = other ? model.nodes[i].inputs.filter((j) => (other.mask >>> j) & 1) : [];
        history.forEach((_, t) => {
          const x = LABEL + (start + t) * cell;
          if (bit(t, i)) {
            g.fillStyle = t === history.length - 1 ? "#000" : "#ffd93d";
            g.fillRect(x, top + 1, Math.max(1, cell - 1), row - 2);
          }
          if (t && sources.some((j) => bit(t - 1, j) === bit(t, i))) {
            g.fillStyle = other!.color;
            g.fillRect(x, top + row - 4, Math.max(1, cell - 1), 3);
          }
        });
        if (y === picked.size - 1) {
          g.fillStyle = "#000";
          g.fillRect(0, top + row - 1, width, 2);
        }
      });
      g.fillStyle = "#000";
      g.fillRect(LABEL - 2, 0, 2, height);
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(element);
    return () => observer.disconnect();
  }, [model, history, rows, n, row]);
  return (
    <canvas
      ref={canvas}
      className="timeline"
      style={{ height: n * row }}
      role="img"
      aria-label={`Last ${history.length} ticks. Rows are neurons, the group in focus first; filled cells are on; a bar marks a neuron that copies the other half one tick later.`}
    />
  );
}
